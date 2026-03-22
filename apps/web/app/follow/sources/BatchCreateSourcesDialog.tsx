"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import type { Proxy } from "@/app/generated/prisma";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ControlledSelect } from "@/components/ui/controlled-select";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetcher } from "@/lib/fetcher";

type BatchTemplate = {
  key: string;
  type: "WEB" | "DARKNET" | "SEARCH_ENGINE" | "SOCIAL_MEDIA";
  category: "STREAM" | "INTERACTIVE" | "RETRIEVAL";
  platform: string;
  driver: string;
  networkPolicy: "DEFAULT" | "TOR_SOCKS5H";
  tags: string[];
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

const SELECT_NONE = "__none__";
const EMPTY_ARG_ENTRY = { key: "", value: "" };

type ScriptArgEntry = {
  key: string;
  value: string;
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

function toScriptArgEntries(value: unknown): ScriptArgEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{ ...EMPTY_ARG_ENTRY }];
  }
  const entries = Object.entries(value as Record<string, unknown>).map(([key, raw]) => ({
    key,
    value: typeof raw === "string" ? raw : JSON.stringify(raw),
  }));
  return entries.length > 0 ? entries : [{ ...EMPTY_ARG_ENTRY }];
}

function toScriptArgs(entries: ScriptArgEntry[]): Record<string, string> {
  const pairs = entries
    .map((entry) => ({ key: entry.key.trim(), value: entry.value.trim() }))
    .filter((entry) => entry.key.length > 0);
  return Object.fromEntries(pairs.map((entry) => [entry.key, entry.value]));
}

function groupedByCategory(templates: BatchTemplate[]) {
  return templates.reduce<Record<string, BatchTemplate[]>>((acc, template) => {
    acc[template.category] = acc[template.category] ?? [];
    acc[template.category].push(template);
    return acc;
  }, {});
}

function categoryLabel(category: BatchTemplate["category"]): string {
  if (category === "STREAM") return "Stream Platforms";
  if (category === "INTERACTIVE") return "Interactive Platforms";
  return "Retrieval Platforms";
}

function groupedByPlatform(templates: BatchTemplate[]) {
  return templates.reduce<Record<string, BatchTemplate[]>>((acc, template) => {
    const key = template.platform || template.category;
    acc[key] = acc[key] ?? [];
    acc[key].push(template);
    return acc;
  }, {});
}

const BatchCreateSourcesDialog = ({ proxies }: { proxies: Proxy[] }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<string, ItemFormState>>({});
  const [defaults, setDefaults] = useState<{
    active: boolean;
  }>({
    active: true,
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

  const groupedTemplates = useMemo(() => groupedByCategory(templates), [templates]);

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
          className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0 sm:w-[94vw] sm:max-w-[1240px]"
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
                    Object.entries(groupedTemplates).map(([category, items]) => (
                      <div key={category} className="space-y-2">
                        <div className="text-sm font-semibold">
                          {categoryLabel(category as BatchTemplate["category"])}
                        </div>
                        <div className="space-y-3">
                          {Object.entries(groupedByPlatform(items)).map(([platform, platformItems]) => (
                            <div key={`${category}-${platform}`} className="space-y-2">
                              <div className="text-xs font-semibold text-muted-foreground">{platform}</div>
                              {platformItems.map((template) => {
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
                                      <Badge variant="outline">{template.category}</Badge>
                                      <Badge variant="outline">{template.driver}</Badge>
                                      <Badge variant="outline">{template.intent.type}</Badge>
                                      {(template.tags ?? []).includes("darknet") ? (
                                        <Badge variant="secondary">darknet</Badge>
                                      ) : null}
                                      {template.exists ? <Badge>EXISTS</Badge> : null}
                                    </div>
                                    <div className="text-xs text-muted-foreground break-words">
                                      {template.description}
                                    </div>
                                    {template.networkPolicy === "TOR_SOCKS5H" ? (
                                      <div className="text-xs text-amber-600">
                                        Network: TOR / socks5h required
                                      </div>
                                    ) : null}
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
                          ))}
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Active</Label>
                        <Select
                          value={defaults.active ? "true" : "false"}
                          onValueChange={(value) =>
                            setDefaults((prev) => ({
                              ...prev,
                              active: value === "true",
                            }))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">true</SelectItem>
                            <SelectItem value="false">false</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-xs text-muted-foreground sm:col-span-2">
                        Active=false 的源会创建成功，但不会显示在 Query 里。
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
                          <div className="text-xs text-muted-foreground">{template.description}</div>

                          <div className="space-y-2">
                            <Label>Script Args</Label>
                            <div className="grid gap-2">
                              {toScriptArgEntries(getByPath(config, "intent.args")).map(
                                (entry, index, list) => (
                                  <div
                                    key={`${template.key}-arg-${index}`}
                                    className="grid grid-cols-[1fr_1fr_auto_auto] gap-2"
                                  >
                                    <Input
                                      placeholder="key"
                                      value={entry.key}
                                      onChange={(event) => {
                                        const next = toScriptArgEntries(
                                          getByPath(getCurrentConfig(template), "intent.args")
                                        );
                                        next[index] = {
                                          ...next[index],
                                          key: event.target.value,
                                        };
                                        handleConfigChange(
                                          template.key,
                                          "intent.args",
                                          toScriptArgs(next)
                                        );
                                      }}
                                    />
                                    <Input
                                      placeholder="value"
                                      value={entry.value}
                                      onChange={(event) => {
                                        const next = toScriptArgEntries(
                                          getByPath(getCurrentConfig(template), "intent.args")
                                        );
                                        next[index] = {
                                          ...next[index],
                                          value: event.target.value,
                                        };
                                        handleConfigChange(
                                          template.key,
                                          "intent.args",
                                          toScriptArgs(next)
                                        );
                                      }}
                                    />
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      aria-label="Add arg row"
                                      onClick={() => {
                                        const next = toScriptArgEntries(
                                          getByPath(getCurrentConfig(template), "intent.args")
                                        );
                                        next.splice(index + 1, 0, { ...EMPTY_ARG_ENTRY });
                                        handleConfigChange(
                                          template.key,
                                          "intent.args",
                                          toScriptArgs(next)
                                        );
                                      }}
                                    >
                                      <Plus className="size-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      aria-label="Remove arg row"
                                      disabled={list.length <= 1}
                                      onClick={() => {
                                        if (list.length <= 1) return;
                                        const next = toScriptArgEntries(
                                          getByPath(getCurrentConfig(template), "intent.args")
                                        ).filter((_, itemIndex) => itemIndex !== index);
                                        handleConfigChange(
                                          template.key,
                                          "intent.args",
                                          toScriptArgs(next)
                                        );
                                      }}
                                    >
                                      <Minus className="size-4" />
                                    </Button>
                                  </div>
                                )
                              )}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label>Network</Label>
                            <ControlledSelect
                              value={String((config.proxyId as string | undefined) ?? "") || null}
                              onValueChange={(value) =>
                                handleConfigChange(template.key, "proxyId", value)
                              }
                              placeholder="No proxy"
                            >
                              {proxies.map((proxy) => (
                                <SelectItem key={proxy.id} value={proxy.id}>
                                  {proxy.name}
                                </SelectItem>
                              ))}
                            </ControlledSelect>
                          </div>

                          {template.credentialRequirements.map((requirement) => {
                            const options = credentials.filter((item) => item.kind === requirement.kind);
                            return (
                              <div key={requirement.kind} className="space-y-1.5">
                                <Label>{requirement.description}</Label>
                                <Select
                                  value={
                                    state[template.key]?.credentialRefs?.[requirement.kind] ??
                                    SELECT_NONE
                                  }
                                  onValueChange={(value) =>
                                    handleCredentialRefChange(
                                      template.key,
                                      requirement.kind,
                                      value === SELECT_NONE ? "" : value
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select credential" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={SELECT_NONE}>Select credential</SelectItem>
                                  {options.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name}
                                    </SelectItem>
                                  ))}
                                  </SelectContent>
                                </Select>
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
