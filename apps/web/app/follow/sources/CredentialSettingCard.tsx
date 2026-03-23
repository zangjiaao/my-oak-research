"use client";

import { useEffect, useMemo, useState } from "react";
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
import { DeleteAlert, SettingCard, DataTable, DataTableAction, DataTableColumn } from "@/components/common";
import { MultiSelect } from "@/components/common/multi-select";
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
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<CredentialListItem | null>(null);
  const [kind, setKind] = useState("x-cookie");
  const [name, setName] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [secret, setSecret] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editName, setEditName] = useState("");
  const [editSecret, setEditSecret] = useState("");

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

  const sourceOptions = useMemo(
    () => {
      const kindPlatform = kindToPlatform(kind).toLowerCase();
      return sources
        .filter((source) => {
          const socialPlatform =
            "social" in source && source.social?.platform
              ? String(source.social.platform).toLowerCase()
              : "";
          const searchPlatform =
            "search" in source && source.search?.platform
              ? String(source.search.platform).toLowerCase()
              : "";
          const searchProvider =
            "search" in source &&
            source.search?.options &&
            typeof source.search.options === "object" &&
            !Array.isArray(source.search.options)
              ? String(
                  (source.search.options as Record<string, unknown>).provider ?? ""
                ).toLowerCase()
              : "";

          if (isApiKeyKind(kind)) {
            return searchPlatform === kindPlatform || searchProvider === kindPlatform;
          }
          return socialPlatform === kindPlatform;
        })
        .map((source) => ({
          label: source.name,
          value: source.id,
        }));
    },
    [kind, sources]
  );

  useEffect(() => {
    const allowedIds = new Set(sourceOptions.map((option) => option.value));
    setSourceIds((prev) => prev.filter((id) => allowedIds.has(id)));
  }, [sourceOptions]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["credentials"] });
    await queryClient.invalidateQueries({ queryKey: ["sources"] });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const normalizedSourceIds = sourceIds;
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
            sourceIds: normalizedSourceIds,
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
        if (normalizedSourceIds.length > 0) {
          formData.append("sourceIds", JSON.stringify(normalizedSourceIds));
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
            sourceIds: normalizedSourceIds,
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
      setSourceIds([]);
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

  const patchMutation = useMutation({
    mutationFn: async () => {
      if (!editingCredential) {
        throw new Error("No credential selected");
      }
      const nextName = editName.trim();
      if (!nextName) {
        throw new Error("Credential name is required");
      }
      const payload: Record<string, string> = {};
      if (nextName !== editingCredential.name) {
        payload.name = nextName;
      }
      if (isApiKeyKind(editingCredential.kind) && editSecret.trim()) {
        payload.secret = editSecret.trim();
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("No changes to update");
      }

      await apiFetcher(`/api/follow/credentials/${editingCredential.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast.success("Credential updated");
      setEditDialogOpen(false);
      setEditingCredential(null);
      setEditName("");
      setEditSecret("");
      await refresh();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update credential");
    },
  });

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
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setEditingCredential(item);
            setEditName(item.name);
            setEditSecret("");
            setEditDialogOpen(true);
          }}
        >
          <PencilIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "delete",
      render: (item) => (
        <DeleteAlert
          item={item}
          itemName="name"
          title="Delete Credential"
          description={(credential) =>
            `Are you sure you want to delete "${credential.name}" credential? This action cannot be undone.`
          }
          queryKeys={[["credentials"], ["credentials", "all"], ["sources"]]}
          deleteEndpoint={(id) => `/api/follow/credentials/${id}`}
          triggerButton={
            <Button size="sm" variant="outline">
              <TrashIcon className="size-3" />
            </Button>
          }
        />
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
              setSourceIds([]);
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
                <Label>Bind Sources (Optional)</Label>
                <MultiSelect
                  options={sourceOptions}
                  value={sourceIds}
                  onValueChange={setSourceIds}
                  placeholder="No source binding"
                  className="bg-background"
                />
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
                  key="credential-secret-input"
                  className="bg-background"
                  placeholder="API key"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
              ) : (
                <Input
                  key="credential-file-input"
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
      <SettingEditDialog
        props={{
          open: editDialogOpen,
          onOpenChange: (open) => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingCredential(null);
              setEditName("");
              setEditSecret("");
            }
          },
        }}
        title="Edit Credential"
        description="Update credential alias or rotate API key."
        triggerButton={<span className="hidden" />}
        buttonText={patchMutation.isPending ? "Saving..." : "Save"}
        onSubmit={(event) => {
          event.preventDefault();
          patchMutation.mutate();
        }}
      >
        {editingCredential ? (
          <div className="grid gap-4">
            <Card className="gap-4 bg-muted/30">
              <CardHeader>
                <CardTitle>Basic Info</CardTitle>
                <CardDescription>Update credential display name.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Kind</Label>
                  <Input className="bg-background" value={editingCredential.kind} disabled />
                </div>
                <div className="grid gap-2">
                  <Label>Alias</Label>
                  <Input
                    className="bg-background"
                    placeholder="Credential alias"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
            {isApiKeyKind(editingCredential.kind) && (
              <Card className="gap-4 bg-muted/30">
                <CardHeader>
                  <CardTitle>Rotate Secret</CardTitle>
                  <CardDescription>
                    Leave empty to keep current key, or input a new key to rotate.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <Label>New API Key</Label>
                  <Input
                    className="bg-background"
                    placeholder="New API key (optional)"
                    value={editSecret}
                    onChange={(event) => setEditSecret(event.target.value)}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
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
