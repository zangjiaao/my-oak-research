"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, PlusIcon, ShieldCheck, PencilIcon, TrashIcon } from "lucide-react";
import { SettingCard, DataTable, DataTableAction, DataTableColumn } from "@/components/common";
import { apiFetcher } from "@/lib/fetcher";
import { kindToPlatform, isApiKeyKind } from "@/lib/credential-utils";
import { useFollow } from "@/hooks/useFollow";
import { toast } from "sonner";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type CredentialListItem = {
  id: string;
  name: string;
  kind: string;
  platform: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  authType: string | null;
  hasStorageObject: boolean;
  secretMasked: string | null;
};

const KIND_OPTIONS = [
  "x-cookie",
  "xiaohongshu-cookie",
  "reddit-cookie",
  "telegram-cookie",
  "whatsapp-profile",
  "parallel-api-key",
  "tavily-api-key",
  "anspire-api-key",
];

function platformFromKind(kind: string): string {
  return kindToPlatform(kind);
}

export default function CredentialSettingCard() {
  const queryClient = useQueryClient();
  const { sources } = useFollow();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState("x-cookie");
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState<string>("__none__");
  const [secret, setSecret] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const credentialQuery = useQuery<{ credentials: CredentialListItem[] }>({
    queryKey: ["credentials", "all"],
    queryFn: () => apiFetcher("/api/follow/credentials"),
  });
  const credentials = credentialQuery.data?.credentials ?? [];

  const filteredCredentials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return credentials;
    return credentials.filter((item) =>
      [item.name, item.kind, item.platform]
        .filter(Boolean)
        .some((token) => token.toLowerCase().includes(q))
    );
  }, [credentials, searchQuery]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["credentials"] });
    await queryClient.invalidateQueries({ queryKey: ["sources"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const normalizedSourceId = sourceId === "__none__" ? undefined : sourceId;
      if (isApiKeyKind(kind)) {
        if (!secret.trim()) {
          throw new Error("API key is required");
        }
        return apiFetcher("/api/follow/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || `${kind}_credential`,
            kind,
            sourceId: normalizedSourceId,
            secret: secret.trim(),
          }),
        });
      }

      if (!file) {
        throw new Error("Credential file is required");
      }
      if (kind === "whatsapp-profile") {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("name", name.trim() || "whatsapp_profile_auth");
        if (normalizedSourceId) {
          formData.append("sourceId", normalizedSourceId);
        }
        const response = await fetch("/api/follow/sources/auth/whatsapp/cookie", {
          method: "POST",
          body: formData,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) {
          throw new Error(result?.error?.message ?? result?.message ?? "Upload failed");
        }
        return result;
      }

      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const response = await fetch(
        `/api/follow/sources/auth/${encodeURIComponent(platformFromKind(kind))}/cookie`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim() || undefined,
            sourceId: normalizedSourceId,
            authData: parsed,
          }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error?.message ?? result?.message ?? "Upload failed");
      }
      return result;
    },
    onSuccess: async () => {
      toast.success("Credential saved");
      setDialogOpen(false);
      setName("");
      setKind("x-cookie");
      setSourceId("__none__");
      setSecret("");
      setFile(null);
      await refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save credential");
    },
  });

  const verifyCredential = async (credentialId: string) => {
    try {
      const result = await apiFetcher(`/api/follow/credentials/${credentialId}/verify`, {
        method: "POST",
      });
      if (result?.verified) {
        toast.success(result.message || "Credential verified");
      } else {
        toast.error(result.message || "Credential verification failed");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Credential verification failed");
    }
  };

  const patchCredential = async (credential: CredentialListItem) => {
    const nextName = window.prompt("Credential name", credential.name);
    if (!nextName || nextName.trim() === credential.name) return;
    try {
      await apiFetcher(`/api/follow/credentials/${credential.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName.trim() }),
      });
      toast.success("Credential updated");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update credential");
    }
  };

  const deleteCredential = async (credential: CredentialListItem) => {
    if (!window.confirm(`Delete credential "${credential.name}"?`)) return;
    try {
      await apiFetcher(`/api/follow/credentials/${credential.id}`, {
        method: "DELETE",
      });
      toast.success("Credential deleted");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete credential");
    }
  };

  const columns: DataTableColumn<CredentialListItem>[] = [
    { key: "name", label: "Name" },
    { key: "kind", label: "Kind" },
    {
      key: "authType",
      label: "Auth Type",
      render: (item) => item.authType ?? "-",
    },
    {
      key: "usageCount",
      label: "Usage",
      render: (item) => String(item.usageCount ?? 0),
    },
    {
      key: "updatedAt",
      label: "Updated",
      render: (item) => new Date(item.updatedAt).toLocaleString(),
    },
  ];

  const actions: DataTableAction<CredentialListItem>[] = [
    {
      type: "custom",
      render: (item) => (
        <Button size="sm" variant="outline" onClick={() => verifyCredential(item.id)}>
          <ShieldCheck className="size-3" />
        </Button>
      ),
    },
    {
      type: "edit",
      render: (item) => (
        <Button size="sm" variant="outline" onClick={() => patchCredential(item)}>
          <PencilIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "delete",
      render: (item) => (
        <Button size="sm" variant="outline" onClick={() => deleteCredential(item)}>
          <TrashIcon className="size-3" />
        </Button>
      ),
    },
  ];

  const filterComponent = (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search credentials..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>
      <SettingEditDialog
        props={{
          open: dialogOpen,
          onOpenChange: (open) => {
            setDialogOpen(open);
            if (!open) {
              setKind("x-cookie");
              setName("");
              setSourceId("__none__");
              setSecret("");
              setFile(null);
            }
          },
        }}
        title="Add Credential"
        description="Add a new auth credential or API key."
        triggerButton={<Button type="button">
          <PlusIcon className="size-4" />
          Add Credential
        </Button>}
        buttonText={createMutation.isPending ? "Saving..." : "Add"}
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
      >
        <div className="grid gap-4">
          <Card className="gap-4 bg-muted/30">
            <CardHeader>
              <CardTitle>Basic Info</CardTitle>
              <CardDescription>Configure credential kind, alias, and source binding.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select kind" />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Alias</Label>
                <Input
                  className="bg-background"
                  placeholder="Credential alias"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label>Bind Source (Optional)</Label>
                <Select value={sourceId} onValueChange={setSourceId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Bind source (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No source binding</SelectItem>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          <Card className="gap-4 bg-muted/30">
            <CardHeader>
              <CardTitle>Credential Payload</CardTitle>
              <CardDescription>
                {isApiKeyKind(kind)
                  ? "Enter API key secret for this provider."
                  : "Upload credential file to be validated and stored."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Label>{isApiKeyKind(kind) ? "API Key" : "Credential File"}</Label>
              {isApiKeyKind(kind) ? (
                <Input
                  className="bg-background"
                  placeholder="API key"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
              ) : (
                <Input
                  className="bg-background"
                  type="file"
                  accept={kind === "whatsapp-profile" ? ".zip" : ".json"}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </SettingEditDialog>
    </div>
  );

  return (
    <SettingCard
      title="Manage Credentials"
      description="Manage shared auth credentials and API keys."
      count={filteredCredentials.length}
      countLabel="credentials"
      filterComponent={filterComponent}
    >
      <DataTable
        data={filteredCredentials}
        columns={columns}
        actions={actions}
        emptyMessage="No credentials found."
      />
    </SettingCard>
  );
}
