"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { apiFetcher } from "@/lib/fetcher";
import type { Proxy } from "@/app/generated/prisma";

type BatchTemplate = {
  key: string;
  type: "WEB" | "DARKNET" | "SEARCH_ENGINE" | "SOCIAL_MEDIA";
  platform: string;
  driver: string;
  intent: { type: string; args: Record<string, unknown> };
  title: string;
  description: string;
  requiredFields: string[];
  credentialRequirements: Array<{ kind: string; required: boolean; description: string }>;
  defaultConfig: Record<string, unknown>;
  exists: boolean;
  missingRequirements: string[];
};

type Credential = {
  id: string;
  name: string;
  kind: string;
};

type BatchCreateResponse = {
  created: Array<{ key: string; sourceId: string; name: string }>;
  skipped: Array<{ key: string; reason: "EXISTS" | "UNSELECTED" }>;
  invalid: Array<{ key: string; missingFields: string[]; message: string }>;
  failed: Array<{ key: string; error: string }>;
};

type ItemFormState = {
  enabled: boolean;
  config: Record<string, unknown>;
  credentialRefs?: Record<string, string | null>;
};

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function getByPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(seg);
      return Number.isInteger(index) ? acc[index] : undefined;
    }
    if (typeof acc === "object") {
      return (acc as Record<string, unknown>)[seg];
    }
    return undefined;
  }, input);
}

function setByPath(input: Record<string, unknown>, path: string, value: unknown) {
  const output = structuredClone(input);
  const segments = path.split(".");
  let current: Record<string, unknown> = output;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value;
  return output;
}

function labelFromPath(path: string): string {
  return path
    .split(".")
    .slice(-1)[0]
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}

function groupedByPlatform(templates: BatchTemplate[]) {
  return templates.reduce<Record<string, BatchTemplate[]>>((acc, template) => {
    acc[template.platform] = acc[template.platform] ?? [];
    acc[template.platform].push(template);
    return acc;
  }, {});
}

const BatchCreateSourcesDialog = ({ proxies }: { proxies: Proxy[] }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, ItemFormState>>({});
  const [defaults, setDefaults] = useState<{
    active: boolean;
    rateLimit: number;
    proxyId: string | null;
  }>({
    active: true,
    rateLimit: 10,
    proxyId: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [invalidMap, setInvalidMap] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<BatchCreateResponse | null>(null);

  const queryClient = useQueryClient();

  const templateQuery = useQuery<{ total: number; items: BatchTemplate[] }>({
    queryKey: ["source-batch-templates"],
    queryFn: () => apiFetcher("/api/follow/sources/batch-templates"),
    enabled: open,
  });

  const credentialQuery = useQuery<{ credentials: Credential[] }>({
    queryKey: ["credentials"],
    queryFn: () => apiFetcher("/api/follow/credentials"),
    enabled: open,
  });

  const templates = templateQuery.data?.items ?? [];
  const credentials = credentialQuery.data?.credentials ?? [];

  const groupedTemplates = useMemo(() => groupedByPlatform(templates), [templates]);

  const selectedTemplates = templates.filter((item) => state[item.key]?.enabled);

  const getCurrentConfig = (template: BatchTemplate) => ({
    ...template.defaultConfig,
    ...(state[template.key]?.config ?? {}),
  });

  const handleToggle = (template: BatchTemplate, enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      [template.key]: {
        enabled,
        config: prev[template.key]?.config ?? structuredClone(template.defaultConfig),
        credentialRefs: prev[template.key]?.credentialRefs ?? {},
      },
    }));
    setInvalidMap((prev) => ({ ...prev, [template.key]: [] }));
  };

  const handleConfigChange = (key: string, path: string, value: unknown) => {
    setState((prev) => {
      const current = prev[key] ?? { enabled: true, config: {}, credentialRefs: {} };
      return {
        ...prev,
        [key]: {
          ...current,
          config: setByPath(current.config, path, value),
        },
      };
    });
  };

  const handleCredentialRefChange = (key: string, kind: string, value: string) => {
    setState((prev) => {
      const current = prev[key] ?? { enabled: true, config: {}, credentialRefs: {} };
      return {
        ...prev,
        [key]: {
          ...current,
          credentialRefs: {
            ...(current.credentialRefs ?? {}),
            [kind]: value || null,
          },
        },
      };
    });
  };

  const getLocalMissing = (template: BatchTemplate): string[] => {
    const missing: string[] = [];
    const config = getCurrentConfig(template);

    for (const field of template.requiredFields) {
      if (isEmptyValue(getByPath(config, field))) {
        missing.push(field);
      }
    }

    for (const requirement of template.credentialRequirements) {
      if (!requirement.required) continue;
      const selected = state[template.key]?.credentialRefs?.[requirement.kind];
      const total = credentials.filter((item) => item.kind === requirement.kind).length;
      if (!selected && total <= 0) {
        missing.push(`credential:${requirement.kind}`);
      }
    }

    return Array.from(new Set(missing));
  };

  const submit = async () => {
    const nextInvalidMap: Record<string, string[]> = {};
    for (const template of selectedTemplates) {
      const missing = getLocalMissing(template);
      if (missing.length > 0) {
        nextInvalidMap[template.key] = missing;
      }
    }

    if (Object.keys(nextInvalidMap).length > 0) {
      setInvalidMap(nextInvalidMap);
      toast.error("Selected items are incomplete. Fill required fields or unselect them.");
      return;
    }

    setSubmitting(true);
    setInvalidMap({});

    try {
      const response = await fetch("/api/follow/sources/batch-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "default-user-id",
        },
        body: JSON.stringify({
          items: templates.map((template) => ({
            key: template.key,
            enabled: Boolean(state[template.key]?.enabled),
            config: getCurrentConfig(template),
            credentialRefs: state[template.key]?.credentialRefs,
          })),
          defaults,
        }),
      });

      const payload = (await response.json()) as BatchCreateResponse;
      setResult(payload);

      if (payload.invalid.length > 0) {
        const invalidState: Record<string, string[]> = {};
        for (const item of payload.invalid) {
          invalidState[item.key] = item.missingFields;
        }
        setInvalidMap(invalidState);
        toast.error("Batch create blocked by missing fields.");
        return;
      }

      if (payload.failed.length > 0) {
        toast.error("Batch create failed. Please retry.");
        return;
      }

      toast.success(`Created ${payload.created.length} source(s), skipped ${payload.skipped.length}.`);
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      templateQuery.refetch();
    } catch {
      toast.error("Failed to batch create sources");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon className="size-4" />
        批量创建源
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[92vh] w-[min(96vw,1240px)] max-w-none flex-col overflow-hidden p-0"
          showCloseButton
        >
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>批量创建源</DialogTitle>
            <DialogDescription>
              选择需要创建的源，补充必填参数后一次提交。缺参项可取消勾选后继续。
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)]">
            <div className="min-h-0 border-b xl:border-r xl:border-b-0">
              <ScrollArea className="h-[34vh] px-4 py-4 xl:h-full">
                <div className="space-y-5">
                  {templateQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading templates...
                    </div>
                  ) : (
                    Object.entries(groupedTemplates).map(([platform, items]) => (
                      <div key={platform} className="space-y-2">
                        <div className="text-sm font-semibold">{platform}</div>
                        <div className="space-y-2">
                          {items.map((template) => {
                            const enabled = Boolean(state[template.key]?.enabled);
                            const localMissing = enabled ? getLocalMissing(template) : [];
                            const serverInvalid = invalidMap[template.key] ?? [];
                            return (
                              <label
                                key={template.key}
                                className="block rounded-md border p-3 hover:bg-muted/40"
                              >
                                <div className="flex items-start gap-3">
                                  <Checkbox
                                    checked={enabled}
                                    onCheckedChange={(checked) =>
                                      handleToggle(template, Boolean(checked))
                                    }
                                  />
                                  <div className="min-w-0 flex-1 space-y-2">
                                    <div className="flex flex-wrap items-start gap-2">
                                      <div className="min-w-0 text-sm font-medium break-words">
                                        {template.title}
                                      </div>
                                      <Badge variant="outline">{template.driver}</Badge>
                                      <Badge variant="outline">{template.intent.type}</Badge>
                                      {template.exists ? <Badge>EXISTS</Badge> : null}
                                    </div>
                                    <div className="text-xs text-muted-foreground break-words">
                                      {template.description}
                                    </div>
                                    {(localMissing.length > 0 || serverInvalid.length > 0) && enabled ? (
                                      <div className="text-xs text-red-600 break-words">
                                        Missing: {Array.from(new Set([...localMissing, ...serverInvalid])).join(", ")}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="min-h-0 min-w-0">
              <ScrollArea className="h-full px-6 py-4">
                <div className="space-y-5">
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="text-sm font-semibold">默认参数</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-1">
                        <Label>Active</Label>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                          value={defaults.active ? "true" : "false"}
                          onChange={(event) =>
                            setDefaults((prev) => ({
                              ...prev,
                              active: event.target.value === "true",
                            }))
                          }
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Rate Limit</Label>
                        <Input
                          type="number"
                          min={1}
                          max={600}
                          value={defaults.rateLimit}
                          onChange={(event) =>
                            setDefaults((prev) => ({
                              ...prev,
                              rateLimit: Number(event.target.value || 10),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Proxy</Label>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                          value={defaults.proxyId ?? ""}
                          onChange={(event) =>
                            setDefaults((prev) => ({
                              ...prev,
                              proxyId: event.target.value || null,
                            }))
                          }
                        >
                          <option value="">None</option>
                          {proxies.map((proxy) => (
                            <option key={proxy.id} value={proxy.id}>
                              {proxy.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {selectedTemplates.length === 0 ? (
                    <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                      请选择左侧模板项后填写配置。
                    </div>
                  ) : (
                    selectedTemplates.map((template) => {
                      const config = getCurrentConfig(template);
                      return (
                        <div key={template.key} className="space-y-4 rounded-md border p-4">
                          <div className="text-sm font-semibold">{template.title}</div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label>Name</Label>
                              <Input
                                value={String((config.name as string | undefined) ?? "")}
                                onChange={(event) =>
                                  handleConfigChange(template.key, "name", event.target.value)
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Description</Label>
                              <Input
                                value={String((config.description as string | undefined) ?? "")}
                                onChange={(event) =>
                                  handleConfigChange(template.key, "description", event.target.value)
                                }
                              />
                            </div>
                          </div>

                          {template.requiredFields.map((field) => {
                            const currentValue = getByPath(config, field);
                            const isUrl = field === "url";
                            return (
                              <div key={field} className="space-y-1">
                                <Label>{labelFromPath(field)}</Label>
                                {isUrl ? (
                                  <Textarea
                                    rows={2}
                                    placeholder="One URL per line"
                                    value={String(currentValue ?? "")}
                                    onChange={(event) =>
                                      handleConfigChange(template.key, field, event.target.value)
                                    }
                                  />
                                ) : (
                                  <Input
                                    value={String(currentValue ?? "")}
                                    onChange={(event) =>
                                      handleConfigChange(template.key, field, event.target.value)
                                    }
                                  />
                                )}
                              </div>
                            );
                          })}

                          {template.credentialRequirements.map((requirement) => {
                            const options = credentials.filter((item) => item.kind === requirement.kind);
                            return (
                              <div key={requirement.kind} className="space-y-1.5">
                                <Label>{requirement.description}</Label>
                                <select
                                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                  value={state[template.key]?.credentialRefs?.[requirement.kind] ?? ""}
                                  onChange={(event) =>
                                    handleCredentialRefChange(
                                      template.key,
                                      requirement.kind,
                                      event.target.value
                                    )
                                  }
                                >
                                  <option value="">Select credential</option>
                                  {options.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}

                  {result ? (
                    <>
                      <Separator />
                      <div className="space-y-2 text-sm">
                        <div className="font-semibold">结果摘要</div>
                        <div>Created: {result.created.length}</div>
                        <div>Skipped: {result.skipped.length}</div>
                        <div>Invalid: {result.invalid.length}</div>
                        <div>Failed: {result.failed.length}</div>
                      </div>
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4 sm:justify-between">
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button onClick={submit} disabled={submitting || selectedTemplates.length === 0}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "批量创建"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default BatchCreateSourcesDialog;
