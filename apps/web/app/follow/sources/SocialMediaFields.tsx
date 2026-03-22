import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Control,
  UseFormRegister,
  FieldErrors,
  UseFormWatch,
  FieldError,
  UseFormSetValue,
} from "react-hook-form";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorMessage } from "@/components/business";
import SelectProxy from "./SelectProxy";
import { Proxy } from "@/app/generated/prisma";
import {
  SocialPlatformEnum,
  SocialMediaSourceCreateSchema,
  SourceCreateSchema,
} from "@/app/api/_utils/zod";
import { Controller } from "react-hook-form";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import {
  CheckCircle2,
  Check,
  ChevronsUpDown,
  XCircle,
  Upload,
  Loader2,
  AlertCircle,
  FileJson,
  Plus,
  KeyRound,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getDefaultDriver,
  getSupportedDrivers,
  supportsDriver,
} from "@/lib/social-driver-support";

interface SocialMediaFieldsProps {
  register: UseFormRegister<z.infer<typeof SourceCreateSchema>>;
  control: Control<z.infer<typeof SourceCreateSchema>>;
  errors: FieldErrors<z.infer<typeof SourceCreateSchema>>;
  proxies: Proxy[];
  watch: UseFormWatch<z.infer<typeof SourceCreateSchema>>;
  setValue?: UseFormSetValue<z.infer<typeof SourceCreateSchema>>;
  sourceId?: string;
}

interface AuthStatus {
  status: "idle" | "uploading" | "verifying" | "success" | "error";
  message?: string;
  credentialId?: string;
}

interface CredentialInfo {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
}

const getCredentialKind = (platform: string) => {
  const normalized = platform.trim().toLowerCase();
  if (!normalized) return "unknown-cookie";
  if (normalized === "x" || normalized === "twitter") return "x-cookie";
  if (normalized === "whatsapp") return "whatsapp-profile";
  return `${normalized}-cookie`;
};

type IntentArgRule = {
  required: boolean;
  description: string;
};

type IntentOption = {
  id: string;
  name: string;
  description: string;
  key: string;
  platform: string;
  intentType: string;
  args: Record<string, IntentArgRule>;
  outputField?: Record<string, string> | string[];
};

type GatherScriptCatalogItem = {
  key: string;
  platform: string;
  intent: string;
  mode: string;
  sample?: {
    intentType?: string;
    intentArgs?: Record<string, unknown>;
    outputField?: Record<string, string> | string[];
  };
};

type SourceCapabilityItem = {
  platform: string;
  intents: GatherScriptCatalogItem[];
};

type PlatformIntentStats = {
  intents: number;
};

type IntentArgRow = {
  id: string;
  key: string;
  value: string;
  required?: boolean;
  description?: string;
  preset?: boolean;
};

type AgentScriptRow = {
  id: string;
  json: string;
};

const createEmptyArgRow = (): IntentArgRow => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  key: "",
  value: "",
});

const createEmptyAgentScriptRow = (): AgentScriptRow => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  json: "",
});

const toDelimitedStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[,\n\r，、;；\t]+/g)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
};

type OutputFieldEntry = {
  key: string;
  path: string;
};

const toOutputFieldEntries = (value: unknown): OutputFieldEntry[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ).map((item) => ({ key: item, path: item }));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, rawValue]) => ({
        key: key.trim(),
        path: String(rawValue ?? "").trim(),
      }))
      .filter((item) => item.key.length > 0 && item.path.length > 0);
  }
  return [];
};

const normalizeArgs = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      value == null ? "" : String(value),
    ])
  );
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const getIntentOptionByType = (
  options: IntentOption[],
  intentType?: string | null
) => options.find((item) => item.intentType === intentType) ?? options[0];

const buildIntentArgRows = (
  args: Record<string, string>,
  option: IntentOption
): IntentArgRow[] => {
  const rows: IntentArgRow[] = [];
  const included = new Set<string>();

  for (const [key, rule] of Object.entries(option.args)) {
    rows.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      key,
      value: args[key] ?? "",
      required: rule.required,
      description: rule.description,
      preset: true,
    });
    included.add(key);
  }

  for (const [key, value] of Object.entries(args)) {
    if (included.has(key)) continue;
    rows.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      key,
      value,
      preset: false,
    });
  }

  return rows.length > 0 ? rows : [createEmptyArgRow()];
};

const toIntentArgRules = (
  input: Record<string, unknown> | null | undefined
): Record<string, IntentArgRule> => {
  if (!input || typeof input !== "object") return {};
  const output: Record<string, IntentArgRule> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const raw = value as Record<string, unknown>;
      output[key] = {
        required: Boolean(raw.required),
        description:
          typeof raw.description === "string" ? raw.description : "",
      };
      continue;
    }
    output[key] = {
      required: false,
      description: "",
    };
  }
  return output;
};

export const SocialMediaFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
  setValue,
  sourceId,
}: SocialMediaFieldsProps) => {
  const socialPlatform = watch("social.platform") as string | undefined;
  const selectedDriver = watch("social.config.driver") as string | undefined;
  const currentCredentialId = watch("social.credentialId") as string | null | undefined;
  const currentProxyId = watch("social.proxyId") as string | null | undefined;
  const currentRecordFormat = watch(
    "social.config.agentBrowser.recordSchema.format"
  ) as string | undefined;
  const currentPlaywrightMode = watch(
    "social.config.playwright.mode"
  ) as string | undefined;
  const currentPlaywrightTargetUrl = watch(
    "social.config.playwright.targetUrl"
  ) as string | undefined;
  const currentPlaywrightPoolEnabled = watch(
    "social.config.playwright.poolEnabled"
  ) as boolean | undefined;
  const currentPlaywrightPoolIdleTimeoutMs = watch(
    "social.config.playwright.poolIdleTimeoutMs"
  ) as number | undefined;
  const supportedDrivers = socialPlatform
    ? getSupportedDrivers(socialPlatform)
    : [];
  const resolvedDriver = socialPlatform
    ? supportsDriver(socialPlatform, selectedDriver || "")
      ? selectedDriver
      : getDefaultDriver(socialPlatform)
    : "playwright";

  const socialErrors = errors as FieldErrors<
    z.infer<typeof SocialMediaSourceCreateSchema>
  >;
  const socialConfigErrors = socialErrors.social?.config as
    | FieldErrors<Record<string, unknown>>
    | undefined;

  // Auth state management
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ status: "idle" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [newCredentialName, setNewCredentialName] = useState("");
  const [xArgRows, setXArgRows] = useState<IntentArgRow[]>([
    createEmptyArgRow(),
  ]);
  const [agentScriptRows, setAgentScriptRows] = useState<AgentScriptRow[]>([
    createEmptyAgentScriptRow(),
  ]);
  const [catalogOptions, setCatalogOptions] = useState<IntentOption[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [platformPopoverOpen, setPlatformPopoverOpen] = useState(false);
  const commandListCleanup = useRef<(() => void) | null>(null);
  const commandListRef = useCallback((node: HTMLDivElement | null) => {
    commandListCleanup.current?.();
    commandListCleanup.current = null;
    if (!node) return;

    let touchY = 0;
    const onWheel = (e: WheelEvent) => {
      if (node.scrollHeight <= node.clientHeight) return;
      node.scrollTop += e.deltaY;
      e.preventDefault();
      e.stopPropagation();
    };
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (node.scrollHeight <= node.clientHeight) return;
      const currentY = e.touches[0]?.clientY ?? 0;
      node.scrollTop += touchY - currentY;
      touchY = currentY;
      e.preventDefault();
      e.stopPropagation();
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    commandListCleanup.current = () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
  const [platformPresetStats, setPlatformPresetStats] = useState<
    Record<string, PlatformIntentStats>
  >({});
  const scriptOptions = useMemo(() => catalogOptions, [catalogOptions]);
  const availablePlatforms = useMemo(() => {
    const base = new Set<string>(SocialPlatformEnum.options);
    for (const [platform, stats] of Object.entries(platformPresetStats)) {
      if (stats.intents > 0) {
        base.add(platform);
      }
    }
    return Array.from(base);
  }, [platformPresetStats]);
  const currentPlatformStats = socialPlatform
    ? platformPresetStats[socialPlatform]
    : undefined;
  const selectedProxy = useMemo(
    () => proxies.find((proxy) => proxy.id === currentProxyId) ?? null,
    [proxies, currentProxyId]
  );

  // Credentials list
  const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<CredentialInfo | null>(null);

  const handleDeleteCredential = async () => {
    if (!credentialToDelete) return;

    try {
      const response = await fetch(`/api/follow/credentials/${credentialToDelete.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setCredentials(prev => prev.filter(c => c.id !== credentialToDelete.id));
        if (currentCredentialId === credentialToDelete.id && setValue) {
          setValue("social.credentialId", null);
        }
        setCredentialToDelete(null);
      }
    } catch (error) {
      console.error("Failed to delete credential:", error);
    }
  };

  const getConfigErrorMessage = (key: string) => {
    const value = key
      .split(".")
      .reduce<unknown>((acc, part) => {
        if (!acc || typeof acc !== "object") return undefined;
        return (acc as Record<string, unknown>)[part];
      }, socialConfigErrors as unknown);
    if (!value) return undefined;
    if (
      typeof value === "object" &&
      "message" in value &&
      (value as FieldError).message
    ) {
      return (value as FieldError).message?.toString();
    }
    return undefined;
  };

  // Check if current platform requires cookie auth
  const needsCookieAuth = Boolean(socialPlatform);
  const supportsCredentialForDriver =
    resolvedDriver !== "xhttp";
  const canUseCredential = Boolean(needsCookieAuth && supportsCredentialForDriver);

  useEffect(() => {
    const controller = new AbortController();

    const fetchPlatformPresetStats = async () => {
      try {
        const response = await fetch(
          "/api/follow/source-capabilities?executionEngine=gather_playwright",
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const data = await response.json();
        const capabilityItems = Array.isArray(data?.items)
          ? (data.items as SourceCapabilityItem[])
          : [];

        const stats: Record<string, PlatformIntentStats> = {};
        for (const item of capabilityItems) {
          const platform = item.platform?.toUpperCase?.() ?? "";
          if (!platform) continue;
          stats[platform] = {
            intents: Array.isArray(item.intents) ? item.intents.length : 0,
          };
        }

        setPlatformPresetStats(stats);
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") {
          console.error("Failed to fetch gather script platform stats:", error);
        }
      }
    };

    fetchPlatformPresetStats();
    return () => controller.abort();
  }, []);

  // Fetch existing credentials when platform changes
  useEffect(() => {
    if (!canUseCredential || !socialPlatform) {
      setCredentials([]);
      return;
    }

    const fetchCredentials = async () => {
      setLoadingCredentials(true);
      try {
        const kind = getCredentialKind(socialPlatform);
        const response = await fetch(`/api/follow/credentials?kind=${kind}`);
        if (response.ok) {
          const data = await response.json();
          setCredentials(data.credentials || []);
        }
      } catch (error) {
        console.error("Failed to fetch credentials:", error);
      } finally {
        setLoadingCredentials(false);
      }
    };

    fetchCredentials();
  }, [socialPlatform, canUseCredential]);

  useEffect(() => {
    if (!socialPlatform || resolvedDriver !== "playwright") {
      setCatalogOptions([]);
      return;
    }

    const controller = new AbortController();
    const fetchCatalog = async () => {
      setLoadingCatalog(true);
      try {
        const response = await fetch(
          `/api/follow/source-capabilities?executionEngine=gather_playwright&platform=${encodeURIComponent(
            socialPlatform
          )}`,
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const data = await response.json();
        const capabilityItem = Array.isArray(data?.items)
          ? ((data.items as SourceCapabilityItem[])[0] ?? null)
          : null;
        const items = capabilityItem?.intents ?? [];
        const nextOptions: IntentOption[] = items
          .map((item) => ({
            id: `${item.platform}:${item.intent}:${item.key}`,
            key: item.key,
            name: item.key,
            platform: item.platform,
            intentType: item.intent,
            description: `${item.platform.toLowerCase()}.${item.intent}`,
            args: toIntentArgRules(item.sample?.intentArgs),
            outputField: item.sample?.outputField,
          }))
          .filter((item) => item.intentType.trim().length > 0);
        setCatalogOptions(nextOptions);
      } catch (error) {
        if ((error as { name?: string })?.name !== "AbortError") {
          console.error("Failed to fetch gather scripts catalog:", error);
        }
      } finally {
        setLoadingCatalog(false);
      }
    };

    fetchCatalog();
    return () => controller.abort();
  }, [socialPlatform, resolvedDriver]);

  useEffect(() => {
    if (!setValue) return;
    if (socialPlatform && resolvedDriver === "xhttp") {
      setValue("social.credentialId", null, { shouldDirty: true });
      setShowUploadForm(false);
      setSelectedFile(null);
      setAuthStatus({ status: "idle" });
    }
  }, [setValue, socialPlatform, resolvedDriver]);

  useEffect(() => {
    if (!setValue) return;
    if (!currentProxyId) {
      (setValue as any)("social.config.network", undefined, {
        shouldDirty: true,
      });
    }
  }, [setValue, currentProxyId]);

  useEffect(() => {
    if (!setValue) return;
    if (!socialPlatform || resolvedDriver !== "agent-browser") return;

    if (!currentRecordFormat) {
      setValue("social.config.agentBrowser.recordSchema.format", "jsonl", {
        shouldDirty: false,
      });
    }
  }, [
    setValue,
    socialPlatform,
    resolvedDriver,
    currentRecordFormat,
  ]);

  useEffect(() => {
    if (!setValue) return;
    if (!socialPlatform || resolvedDriver !== "playwright") return;
    if (typeof currentPlaywrightPoolEnabled !== "boolean") {
      setValue("social.config.playwright.poolEnabled", true, {
        shouldDirty: false,
      });
    }
    if (
      typeof currentPlaywrightPoolIdleTimeoutMs !== "number" ||
      !Number.isFinite(currentPlaywrightPoolIdleTimeoutMs) ||
      currentPlaywrightPoolIdleTimeoutMs < 1000
    ) {
      setValue("social.config.playwright.poolIdleTimeoutMs", 120000, {
        shouldDirty: false,
      });
    }
    if (currentPlaywrightMode !== "eval-js") {
      setValue("social.config.playwright.mode", "eval-js", {
        shouldDirty: false,
      });
    }
    if (
      typeof currentPlaywrightTargetUrl === "string" &&
      currentPlaywrightTargetUrl.trim()
    ) {
      setValue("social.config.playwright.targetUrl", "", {
        shouldDirty: false,
      });
    }
  }, [
    setValue,
    socialPlatform,
    resolvedDriver,
    currentPlaywrightMode,
    currentPlaywrightTargetUrl,
    currentPlaywrightPoolEnabled,
    currentPlaywrightPoolIdleTimeoutMs,
  ]);

  const syncArgsToForm = useCallback(
    (rows: IntentArgRow[]) => {
      if (!setValue) return;
      const args = rows.reduce<Record<string, string>>((acc, row) => {
        const key = row.key.trim();
        if (!key) return acc;
        acc[key] = row.value;
        return acc;
      }, {});
      setValue("social.config.intent.args", args as any, { shouldDirty: true });
    },
    [setValue]
  );

  const applyScriptDefaults = useCallback(
    (
      intentType: string,
      scriptOptions: IntentOption[],
      incomingArgs: unknown,
      config?: {
        markDirty?: boolean;
      }
    ) => {
      if (!setValue) return;
      const option = getIntentOptionByType(scriptOptions, intentType);
      if (!option) return;
      const currentArgs = normalizeArgs(incomingArgs);
      const nextArgs = Object.fromEntries(
        Object.keys(option.args).map((argKey) => [argKey, currentArgs[argKey] ?? ""])
      );
      const rows = buildIntentArgRows(nextArgs, option);
      setValue("social.config.intent.type", option.intentType, {
        shouldDirty: config?.markDirty ?? false,
      });
      setValue("social.config.intent.args", nextArgs as any, {
        shouldDirty: config?.markDirty ?? false,
      });
      setXArgRows(rows);
    },
    [setValue]
  );

  const syncAgentScriptToForm = useCallback(
    (rows: AgentScriptRow[]) => {
      if (!setValue) return;
      const script = rows
        .map((row) => row.json.trim())
        .filter(Boolean)
        .map((row) => {
          try {
            const parsed = JSON.parse(row);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              return parsed as Record<string, unknown>;
            }
            return null;
          } catch {
            return null;
          }
        })
        .filter((step): step is Record<string, unknown> => Boolean(step));
      setValue("social.config.agentBrowser.script", script, {
        shouldDirty: true,
      });
    },
    [setValue]
  );

  useEffect(() => {
    if (!setValue) return;
    if (!socialPlatform) return;
    if (!supportsDriver(socialPlatform, selectedDriver || "")) {
      setValue("social.config.driver", getDefaultDriver(socialPlatform));
    }
  }, [setValue, socialPlatform, selectedDriver]);

  useEffect(() => {
    if (resolvedDriver !== "playwright") return;
    if (scriptOptions.length === 0) return;
    const intentType = watch("social.config.intent.type") as string | undefined;
    const normalizedIntentType = intentType || scriptOptions[0].intentType;
    const rawArgs = watch("social.config.intent.args");
    applyScriptDefaults(normalizedIntentType, scriptOptions, rawArgs);
  }, [resolvedDriver, scriptOptions, watch, applyScriptDefaults]);

  useEffect(() => {
    if (resolvedDriver !== "playwright") return;
    if (scriptOptions.length > 0) return;
    const rawArgs = normalizeArgs(watch("social.config.intent.args"));
    const rows = Object.entries(rawArgs).map(([key, value]) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      key,
      value,
      preset: false,
    })) as IntentArgRow[];
    setXArgRows(rows.length > 0 ? rows : [createEmptyArgRow()]);
  }, [resolvedDriver, scriptOptions.length, watch]);

  useEffect(() => {
    if (resolvedDriver !== "agent-browser") return;
    const rawScript = watch("social.config.agentBrowser.script");
    const rows = Array.isArray(rawScript)
      ? rawScript
          .map((step) => {
            if (!step || typeof step !== "object") return null;
            return {
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              json: JSON.stringify(step, null, 2),
            } satisfies AgentScriptRow;
          })
          .filter(Boolean)
      : [];
    setAgentScriptRows(rows.length > 0 ? (rows as AgentScriptRow[]) : [createEmptyAgentScriptRow()]);
  }, [resolvedDriver, watch]);

  const updateArgRow = useCallback(
    (id: string, field: "key" | "value", nextValue: string) => {
      const nextRows = xArgRows.map((row) =>
        row.id === id ? { ...row, [field]: nextValue } : row
      );
      setXArgRows(nextRows);
      syncArgsToForm(nextRows);
    },
    [syncArgsToForm, xArgRows]
  );

  const addArgRow = useCallback(() => {
    const nextRows = [...xArgRows, createEmptyArgRow()];
    setXArgRows(nextRows);
    syncArgsToForm(nextRows);
  }, [syncArgsToForm, xArgRows]);

  const removeArgRow = useCallback(
    (id: string) => {
      const rowToRemove = xArgRows.find((row) => row.id === id);
      if (rowToRemove?.required) return;
      const nextRows = xArgRows.filter((row) => row.id !== id);
      const safeRows = nextRows.length > 0 ? nextRows : [createEmptyArgRow()];
      setXArgRows(safeRows);
      syncArgsToForm(safeRows);
    },
    [syncArgsToForm, xArgRows]
  );

  const updateAgentScriptRow = useCallback(
    (id: string, value: string) => {
      const rows = agentScriptRows.map((row) =>
        row.id === id ? { ...row, json: value } : row
      );
      setAgentScriptRows(rows);
      syncAgentScriptToForm(rows);
    },
    [agentScriptRows, syncAgentScriptToForm]
  );

  const addAgentScriptRow = useCallback(() => {
    const rows = [...agentScriptRows, createEmptyAgentScriptRow()];
    setAgentScriptRows(rows);
    syncAgentScriptToForm(rows);
  }, [agentScriptRows, syncAgentScriptToForm]);

  const removeAgentScriptRow = useCallback(
    (id: string) => {
      const rows = agentScriptRows.filter((row) => row.id !== id);
      const safeRows = rows.length > 0 ? rows : [createEmptyAgentScriptRow()];
      setAgentScriptRows(safeRows);
      syncAgentScriptToForm(safeRows);
    },
    [agentScriptRows, syncAgentScriptToForm]
  );

  // Handle file selection
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (socialPlatform === "WHATSAPP") {
        if (!file.name.endsWith('.zip')) {
          setAuthStatus({
            status: "error",
            message: "WhatsApp 认证请选择 .zip 格式的 profile 压缩包",
          });
          return;
        }
      } else {
        if (!file.name.endsWith('.json')) {
          setAuthStatus({
            status: "error",
            message: "请选择 .json 格式的文件",
          });
          return;
        }
      }
      setSelectedFile(file);
      setAuthStatus({ status: "idle" });
    }
  }, [socialPlatform]);

  // Handle auth file upload and verification
  const handleUploadAndVerify = useCallback(async () => {
    if (!selectedFile || !socialPlatform) return;

    setAuthStatus({ status: "uploading", message: "正在读取文件..." });

    try {
      const platformName = socialPlatform === "X" ? "x" : socialPlatform.toLowerCase();

      // Special handling for WhatsApp Profile (Multipart Upload)
      if (socialPlatform === "WHATSAPP") {
        setAuthStatus({ status: "uploading", message: "正在上传 Profile 压缩包..." });

        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("name", newCredentialName || "WHATSAPP_profile");

        const response = await fetch(`/api/follow/sources/auth/${platformName}/cookie`, {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (!response.ok || !result.verified) {
          setAuthStatus({
            status: "error",
            message: result.message || "认证验证失败",
          });
          return;
        }

        setAuthStatus({
          status: "success",
          message: result.message || "认证验证成功！",
          credentialId: result.credentialId,
        });

        // Update form with the new credential ID
        if (setValue && result.credentialId) {
          setValue("social.credentialId", result.credentialId);
        }

        // Refresh credentials list
        const kind = getCredentialKind(socialPlatform);
        const credResponse = await fetch(`/api/follow/credentials?kind=${kind}`);
        if (credResponse.ok) {
          const data = await credResponse.json();
          setCredentials(data.credentials || []);
        }

        setShowUploadForm(false);
        setSelectedFile(null);
        setNewCredentialName("");
        return;
      }

      // Read file content for JSON-based platforms
      const fileContent = await selectedFile.text();
      let authData;

      try {
        authData = JSON.parse(fileContent);
      } catch {
        setAuthStatus({
          status: "error",
          message: "无效的 JSON 文件格式",
        });
        return;
      }

      // Validate basic structure - need either cookies or origins with localStorage
      const hasCookies = authData.cookies && Array.isArray(authData.cookies) && authData.cookies.length > 0;
      const hasOrigins = authData.origins && Array.isArray(authData.origins) && authData.origins.length > 0;

      if (!hasCookies && !hasOrigins) {
        setAuthStatus({
          status: "error",
          message: "无效的认证文件格式：需要 cookies 或 origins 数据",
        });
        return;
      }

      setAuthStatus({ status: "verifying", message: "正在验证认证信息..." });

      // Call API to verify and save
      const response = await fetch(`/api/follow/sources/auth/${platformName}/cookie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authData,
          name: newCredentialName || undefined
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.verified) {
        setAuthStatus({
          status: "error",
          message: result.message || "认证验证失败",
        });
        return;
      }

      setAuthStatus({
        status: "success",
        message: result.message || "认证验证成功！",
        credentialId: result.credentialId,
      });

      // Update form with the new credential ID
      if (setValue && result.credentialId) {
        setValue("social.credentialId", result.credentialId);
      }

      // Refresh credentials list
      const kind = getCredentialKind(socialPlatform);
      const credResponse = await fetch(`/api/follow/credentials?kind=${kind}`);
      if (credResponse.ok) {
        const data = await credResponse.json();
        setCredentials(data.credentials || []);
      }

      // Hide upload form and reset
      setShowUploadForm(false);
      setSelectedFile(null);
      setNewCredentialName("");

    } catch (error) {
      console.error("Auth upload error:", error);
      setAuthStatus({
        status: "error",
        message: error instanceof Error ? error.message : "上传验证失败",
      });
    }
  }, [selectedFile, socialPlatform, setValue, newCredentialName]);

  // Handle credential selection
  const handleCredentialSelect = useCallback((credentialId: string) => {
    if (setValue) {
      setValue("social.credentialId", credentialId === "__none__" ? null : credentialId);
    }
    setShowUploadForm(false);
  }, [setValue]);

  // Get selected credential info
  const selectedCredential = credentials.find(c => c.id === currentCredentialId);
  const selectedIntentType = watch("social.config.intent.type") as
    | string
    | undefined;
  const selectedScript =
    scriptOptions.length > 0
      ? getIntentOptionByType(scriptOptions, selectedIntentType)
      : null;
  const configuredOutputField = (watch as any)("social.config.output.field");
  const outputFieldEntries = useMemo(() => {
    const fromConfig = toOutputFieldEntries(configuredOutputField);
    if (fromConfig.length > 0) return fromConfig;
    return toOutputFieldEntries(selectedScript?.outputField);
  }, [configuredOutputField, selectedScript]);
  const outputFieldKeys = useMemo(
    () => Array.from(new Set(outputFieldEntries.map((item) => item.key))),
    [outputFieldEntries]
  );
  const outputKeywordScopeError = getConfigErrorMessage("output.keywordScope");
  const filterMinCharsError = getConfigErrorMessage("filter.minChars");
  const requestPreview = useMemo(() => {
    if (!socialPlatform) return null;
    const config = asRecord(watch("social.config"));
    const outputConfig = asRecord(config.output);

    const output: Record<string, unknown> = {};
    const rawOutputField = outputConfig.fields ?? outputConfig.field;
    if (Array.isArray(rawOutputField)) {
      const normalizedFields = Array.from(
        new Set(
          rawOutputField
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        )
      );
      if (normalizedFields.length > 0) {
        output.field = normalizedFields;
      }
    } else if (
      rawOutputField &&
      typeof rawOutputField === "object" &&
      !Array.isArray(rawOutputField)
    ) {
      const mappedEntries = Object.entries(rawOutputField as Record<string, unknown>)
        .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0);
      if (mappedEntries.length > 0) {
        output.field = Object.fromEntries(mappedEntries);
      }
    }
    if (!("field" in output) && outputFieldEntries.length > 0) {
      output.field = Object.fromEntries(
        outputFieldEntries.map((item) => [item.key, item.path])
      );
    }
    const keywordScope = toDelimitedStringArray(outputConfig.keywordScope);
    if (keywordScope.length > 0) {
      output.keywordScope = keywordScope;
    }

    const previewConfig = { ...config };
    const intentConfig = asRecord(previewConfig.intent);
    const intentType =
      typeof intentConfig.type === "string" && intentConfig.type.trim()
        ? intentConfig.type.trim()
        : "search";
    const intentArgs = asRecord(intentConfig.args);

    delete previewConfig.driver;
    delete previewConfig.intent;
    delete previewConfig.output;
    delete previewConfig.responseFormats;
    delete previewConfig.filter;
    delete previewConfig.keywordFilter;
    delete previewConfig.driverOptions;

    const driverOption =
      resolvedDriver === "playwright"
        ? {
            ...asRecord(previewConfig.playwright),
            ...(() => {
              const rest = { ...previewConfig };
              delete rest.playwright;
              return rest;
            })(),
          }
        : resolvedDriver === "agent-browser"
          ? {
              ...asRecord(previewConfig.agentBrowser),
              ...(() => {
                const rest = { ...previewConfig };
                delete rest.agentBrowser;
                return rest;
              })(),
            }
          : previewConfig;
    const configuredFilter = asRecord(config.filter);
    const filter: Record<string, unknown> = {};
    if (typeof configuredFilter.minChars === "number") {
      filter.minChars = configuredFilter.minChars;
    }

    const normalizedDriverOption = { ...driverOption };
    if (resolvedDriver === "playwright") {
      delete normalizedDriverOption.mode;
      delete normalizedDriverOption.args;
    }
    if (selectedProxy?.url) {
      normalizedDriverOption.network = {
        ...asRecord(normalizedDriverOption.network),
        proxy: {
          ...asRecord(asRecord(normalizedDriverOption.network).proxy),
          url: selectedProxy.url,
        },
      };
    } else {
      delete normalizedDriverOption.network;
    }

    const driver: Record<string, unknown> = {
      name: resolvedDriver,
      ...normalizedDriverOption,
      script: {
        type: intentType,
        args: intentArgs,
      },
    };
    if (Object.keys(filter).length > 0) {
      driver.filter = filter;
    }

    return {
      sourceId: sourceId ?? "__SOURCE_ID__",
      platform: socialPlatform.toLowerCase(),
      keywords: [],
      driver,
      output,
    };
  }, [
    socialPlatform,
    sourceId,
    resolvedDriver,
    watch,
    selectedProxy,
    outputFieldEntries,
  ]);

  // Render auth status indicator
  const renderAuthStatus = () => {
    switch (authStatus.status) {
      case "uploading":
      case "verifying":
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{authStatus.message}</span>
          </div>
        );
      case "success":
        return (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span>{authStatus.message}</span>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <XCircle className="h-4 w-4" />
            <span>{authStatus.message}</span>
          </div>
        );
      default:
        return null;
    }
  };

  const renderAgentBrowserFields = () => (
    <div className="grid gap-4 rounded-lg border bg-background p-4">
      <div>
        <p className="text-sm font-medium">Agent Browser Option</p>
        <p className="text-xs text-muted-foreground">
          ownerId / sessionKey 由系统统一维护，表单无需填写。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Controller
          name="social.config.agentBrowser.headed"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
              <span className="text-sm">Headed</span>
            </div>
          )}
        />
        <Controller
          name="social.config.agentBrowser.closeOnComplete"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
              <span className="text-sm">Close On Complete</span>
            </div>
          )}
        />
      </div>

      <div className="grid gap-3 rounded-md border bg-background p-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Script Steps (JSON per step)</Label>
          <Button type="button" variant="outline" size="sm" onClick={addAgentScriptRow}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        <div className="grid gap-2">
          {agentScriptRows.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_auto] gap-2 items-start">
              <Textarea
                value={row.json}
                rows={6}
                placeholder='{"command":"open https://web.telegram.org/a/#-1001364377229"}'
                onChange={(e) => updateAgentScriptRow(row.id, e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeAgentScriptRow(row.id)}
                aria-label="Remove script row"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          每行一个 JSON 对象步骤；仅合法 JSON 会被保存到配置。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="social.config.agentBrowser.recordSchema.format">
            Record Schema Format
          </Label>
          <Controller
            name="social.config.agentBrowser.recordSchema.format"
            control={control}
            render={({ field }) => (
              <ControlledSelect
                value={(field.value as string) || "jsonl"}
                onValueChange={field.onChange}
                placeholder="Select format"
              >
                <SelectItem value="jsonl">jsonl</SelectItem>
                <SelectItem value="tagged">tagged</SelectItem>
                <SelectItem value="structured">structured</SelectItem>
                <SelectItem value="auto">auto</SelectItem>
              </ControlledSelect>
            )}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="social.config.agentBrowser.captureFilter.keys">
            Capture Filter Keys
          </Label>
          <Controller
            name="social.config.agentBrowser.captureFilter.keys"
            control={control}
            render={({ field }) => (
              <Textarea
                id="social.config.agentBrowser.captureFilter.keys"
                rows={3}
                placeholder={"xhs_note_text\nxhs_note_meta"}
                value={
                  Array.isArray(field.value)
                    ? field.value.join("\n")
                    : typeof field.value === "string"
                      ? field.value
                      : ""
                }
                onChange={(e) => field.onChange(toDelimitedStringArray(e.target.value))}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">
            支持多个 key，使用逗号或换行分隔。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Controller
          name="social.config.agentBrowser.captureFilter.perLine"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
              <span className="text-sm">Capture Per Line</span>
            </div>
          )}
        />
        <Controller
          name="social.config.agentBrowser.captureFilter.dedupe"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(field.value)}
                onCheckedChange={field.onChange}
              />
              <span className="text-sm">Capture Dedupe</span>
            </div>
          )}
        />
      </div>
    </div>
  );

  const getPlatformOptionLabel = (platform: string) => {
    return platform;
  };

  const renderPlatformBadges = (platform: string) => {
    const stats = platformPresetStats[platform];
    const isCatalogOnly = !SocialPlatformEnum.options.includes(
      platform as (typeof SocialPlatformEnum.options)[number]
    );
    return (
      <div className="flex items-center gap-1">
        {stats?.intents ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            intents:{stats.intents}
          </Badge>
        ) : null}
        {isCatalogOnly ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            catalog only
          </Badge>
        ) : null}
      </div>
    );
  };

  const renderGatherOutputAndFilterFields = () => (
    <Card className="gap-4 bg-muted/30">
      <CardHeader>
        <CardTitle>Output</CardTitle>
        <CardDescription>
          配置关键词过滤范围（字段映射由 worker 规则维护）。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
      <div className="grid gap-2">
        <Label>Output Fields (Worker Managed)</Label>
        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          {outputFieldEntries.length > 0 ? (
            <div className="grid gap-1 font-mono">
              {outputFieldEntries.map((item) => (
                <p key={`${item.key}:${item.path}`}>
                  {item.key}: {item.path}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              当前 intent 未返回 output.field 示例，keywordScope 请先按约定字段填写。
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          output.field 由 worker 规则维护，这里仅展示给 keywordScope 参考。
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="social.config.output.keywordScope">
          Keyword Scope
        </Label>
        <Controller
          name={"social.config.output.keywordScope" as any}
          control={control}
          render={({ field }) => (
            <Textarea
              id="social.config.output.keywordScope"
              rows={2}
              placeholder={
                outputFieldKeys.length > 0
                  ? outputFieldKeys.join("\n")
                  : "text\nmarkdown"
              }
              value={
                Array.isArray(field.value)
                  ? field.value.join("\n")
                  : typeof field.value === "string"
                    ? field.value
                    : ""
              }
              onChange={(event) =>
                field.onChange(toDelimitedStringArray(event.target.value))
              }
            />
          )}
        />
        <p className="text-xs text-muted-foreground">
          关键词过滤仅匹配这里指定的 recordContent 字段。
        </p>
        <ErrorMessage>{outputKeywordScopeError}</ErrorMessage>
      </div>
      </CardContent>
    </Card>
  );

  const renderDriverFilterFields = () => (
    <div className="grid gap-2 rounded-lg border bg-background p-4 md:max-w-xs">
      <div>
        <p className="text-sm font-medium">Driver Filter</p>
        <p className="text-xs text-muted-foreground">
          对 driver 输出结果做基础过滤；将写入 driver.filter。
        </p>
      </div>
        <Label htmlFor="social.config.filter.minChars">Min Chars</Label>
        <Controller
          name={"social.config.filter.minChars" as any}
          control={control}
          render={({ field }) => (
            <Input
              id="social.config.filter.minChars"
              type="number"
              min={0}
              value={
                typeof field.value === "number" ? field.value : field.value ?? ""
              }
              onChange={(event) => {
                const next = event.target.value;
                field.onChange(next === "" ? undefined : Number(next));
              }}
            />
          )}
        />
        <ErrorMessage>{filterMinCharsError}</ErrorMessage>
    </div>
  );

  const renderDriverNetworkFields = () => (
    <div className="grid gap-3 rounded-lg border bg-background p-4">
      <div>
        <p className="text-sm font-medium">Driver Network</p>
        <p className="text-xs text-muted-foreground">
          选择已配置的代理设置；未选择时不会注入 network。
        </p>
      </div>
      <SelectProxy
        control={control}
        proxies={proxies}
        name="social.proxyId"
        error={socialErrors.social?.proxyId?.message?.toString()}
      />
    </div>
  );

  return (
    <>
      <Card className="gap-4 bg-muted/30">
        <CardHeader>
          <CardTitle>Platform</CardTitle>
          <CardDescription>
            选择 source 对应的平台。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3">
            <Controller
              name="social.platform"
              control={control}
              render={({ field }) => (
                <Popover open={platformPopoverOpen} onOpenChange={setPlatformPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={platformPopoverOpen}
                      className="w-full justify-between"
                    >
                      {field.value ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate">
                            {getPlatformOptionLabel(field.value as string)}
                          </span>
                          {renderPlatformBadges(field.value as string)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          Select a social media platform
                        </span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <Command className="max-h-80">
                      <CommandInput placeholder="Search platform..." />
                      <CommandEmpty>No platform found.</CommandEmpty>
                      <CommandList ref={commandListRef} className="max-h-64 overflow-y-auto">
                        <CommandGroup>
                          {availablePlatforms.map((platform) => (
                            <CommandItem
                              key={platform}
                              value={platform}
                              onSelect={() => {
                                const nextPlatform = platform || "X";
                                field.onChange(nextPlatform);
                                setPlatformPopoverOpen(false);
                                setAuthStatus({ status: "idle" });
                                setSelectedFile(null);
                                setShowUploadForm(false);
                                if (setValue) {
                                  setValue("social.credentialId", null);
                                  setValue(
                                    "social.config.driver",
                                    getDefaultDriver(nextPlatform)
                                  );
                                  setValue("social.config.playwright.mode", "eval-js");
                                  setValue("social.config.playwright.headless", false);
                                  setValue("social.config.intent.type", "search");
                                  setValue("social.config.intent.args", {} as any);
                                }
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  field.value === platform ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex w-full items-center justify-between gap-2">
                                <span>{getPlatformOptionLabel(platform)}</span>
                                {renderPlatformBadges(platform)}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            />
            <ErrorMessage>
              {socialErrors.social?.platform?.message?.toString()}
            </ErrorMessage>
            {socialPlatform && (
              <p className="text-xs text-muted-foreground">
                {currentPlatformStats?.intents
                  ? `该平台有 ${currentPlatformStats.intents} 个 gather scripts intent，可直接选择。`
                  : "该平台暂未发现 gather scripts intent，可继续使用自定义 driver 配置。"}
              </p>
            )}
          </div>

        </CardContent>
      </Card>

      {socialPlatform && (
        <Card className="gap-4 bg-muted/30">
          <CardHeader>
            <CardTitle>Driver</CardTitle>
            <CardDescription>
              选择 driver，并配置 option 和 filter。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {supportedDrivers.length > 0 && (
              <div className="grid gap-3">
                <Controller
                  name="social.config.driver"
                  control={control}
                  render={({ field }) => (
                    <Tabs
                      value={resolvedDriver}
                      onValueChange={(value) => {
                        field.onChange(value);
                      }}
                    >
                      <TabsList
                        className="grid w-full"
                        style={{ gridTemplateColumns: `repeat(${supportedDrivers.length}, minmax(0, 1fr))` }}
                      >
                        {supportedDrivers.map((driver) => (
                          <TabsTrigger key={driver} value={driver}>
                            {driver}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  xhttp 不支持认证凭据；playwright / agent-browser 支持凭据。
                </p>
              </div>
            )}

      {/* Cookie Auth Selection Section */}
      {canUseCredential && (
        <div className="grid gap-3 rounded-lg border bg-background p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">认证凭证</Label>
            </div>
            {!showUploadForm && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowUploadForm(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                上传新凭证
              </Button>
            )}
          </div>

          {/* Existing Credentials Selector */}
          {!showUploadForm && (
            <>
              {loadingCredentials ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>加载凭证列表...</span>
                </div>
              ) : credentials.length > 0 ? (
                <div className="grid gap-2">
                  <Label htmlFor="credential-select">选择已有凭证</Label>
                  <Controller
                    name="social.credentialId"
                    control={control}
                    render={({ field }) => (
                      <ControlledSelect
                        value={(field.value as string) || "__none__"}
                        onValueChange={(value) => handleCredentialSelect(value || "__none__")}
                        placeholder="选择凭证"
                      >
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground">不使用凭证</span>
                        </SelectItem>
                        {credentials.map((cred) => (
                          <SelectItem key={cred.id} value={cred.id}>
                            <div className="flex items-center justify-between w-full min-w-[300px]">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                <span>{cred.name}</span>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  (更新于 {new Date(cred.updatedAt).toLocaleDateString()})
                                </span>
                              </div>
                              {/* 
                                  Note: SelectItem intercepts clicks. 
                                  We use asChild if we want a different element, but here we just want to avoid selection.
                                  Actually, putting a button inside SelectItem is tricky.
                                  Let's use a simpler approach: add a small trash icon that users can click.
                              */}
                              <div
                                className="ml-4 p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 text-muted-foreground hover:text-red-500 transition-colors pointer-events-auto z-50 relative"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setCredentialToDelete(cred);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </ControlledSelect>
                    )}
                  />
                  {selectedCredential && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      已选择: {selectedCredential.name}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-md border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                    <span>暂无可用凭证，请上传新的认证文件</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Upload New Credential Form */}
          {showUploadForm && (
            <div className="grid gap-3 p-3 border rounded-md bg-background">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">上传新凭证</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowUploadForm(false);
                    setSelectedFile(null);
                    setNewCredentialName("");
                    setAuthStatus({ status: "idle" });
                  }}
                >
                  取消
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                {socialPlatform === "WHATSAPP" ? (
                  <p>请上传运行脚本导出的 WhatsApp Profile 压缩包 (whatsapp_profile.zip)</p>
                ) : (
                  <p>请上传从 Chrome 导出的 {socialPlatform} 认证文件</p>
                )}
              </div>

              <div className="flex items-center gap-2 p-2 rounded-md border bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
                <div className="text-xs text-yellow-700 dark:text-yellow-400">
                  <p>首先在 Chrome 中登录 {socialPlatform}，然后运行脚本：</p>
                  <code className="block mt-1 p-1 rounded bg-yellow-100 dark:bg-yellow-900/50">
                    python export_chrome_cookies.py {socialPlatform?.toLowerCase()}
                  </code>
                  {socialPlatform === "WHATSAPP" && (
                    <p className="mt-1 text-[10px] opacity-80">注意：WhatsApp 需要将 .auth/whatsapp_profile 目录压缩为 .zip 后上传</p>
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="credential-name" className="text-xs">凭证别名 (可选)</Label>
                <Input
                  id="credential-name"
                  placeholder="例如: 我的主账号, 备选账号..."
                  value={newCredentialName}
                  onChange={(e) => setNewCredentialName(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Input
                    type="file"
                    accept={socialPlatform === "WHATSAPP" ? ".zip" : ".json"}
                    onChange={handleFileSelect}
                    className="cursor-pointer"
                  />
                </div>
                <Button
                  type="button"
                  variant={authStatus.status === "success" ? "outline" : "default"}
                  disabled={!selectedFile || authStatus.status === "uploading" || authStatus.status === "verifying"}
                  onClick={handleUploadAndVerify}
                  className={cn(
                    "min-w-[120px]",
                    authStatus.status === "success" && "border-green-500 text-green-600"
                  )}
                >
                  {authStatus.status === "uploading" || authStatus.status === "verifying" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      验证中...
                    </>
                  ) : authStatus.status === "success" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      已验证
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      上传验证
                    </>
                  )}
                </Button>
              </div>

              {selectedFile && authStatus.status === "idle" && (
                <p className="text-xs text-muted-foreground">
                  已选择: {selectedFile.name}
                </p>
              )}

              {renderAuthStatus()}
            </div>
          )}
        </div>
      )}

      {socialPlatform && (
        <>
          {resolvedDriver === "playwright" && (
            <div className="grid gap-4 rounded-lg border bg-background p-4">
              <div>
                <p className="text-sm font-medium">Playwright Option</p>
                <p className="text-xs text-muted-foreground">
                  选择 gather scripts intent，并配置 intent args。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Controller
                    name="social.config.playwright.headless"
                    control={control}
                    render={({ field }) => (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                        <span className="text-sm">Headless</span>
                      </label>
                    )}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Controller
                    name="social.config.playwright.poolEnabled"
                    control={control}
                    render={({ field }) => (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          checked={Boolean(field.value ?? true)}
                          onCheckedChange={field.onChange}
                        />
                        <span className="text-sm">Enable Driver Pool</span>
                      </label>
                    )}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="social.config.playwright.poolIdleTimeoutMs">
                    Pool Idle Timeout (ms)
                  </Label>
                  <Controller
                    name="social.config.playwright.poolIdleTimeoutMs"
                    control={control}
                    render={({ field }) => (
                      <Input
                        id="social.config.playwright.poolIdleTimeoutMs"
                        type="number"
                        min={1000}
                        step={1000}
                        value={typeof field.value === "number" ? field.value : 120000}
                        onChange={(event) => {
                          if (event.target.value.trim() === "") {
                            field.onChange(120000);
                            return;
                          }
                          const nextValue = Number(event.target.value);
                          field.onChange(Number.isFinite(nextValue) ? nextValue : 120000);
                        }}
                      />
                    )}
                  />
                  <ErrorMessage>
                    {getConfigErrorMessage("playwright.poolIdleTimeoutMs")}
                  </ErrorMessage>
                </div>

                <div className="grid gap-3 md:col-span-2">
                  <Label htmlFor="social.config.intent.type">Intent Template</Label>
                  {scriptOptions.length > 0 && (
                    <Controller
                      name={"social.config.intent.type" as any}
                      control={control}
                      render={({ field }) => (
                        <ControlledSelect
                          value={(field.value as string) || scriptOptions[0].intentType}
                          onValueChange={(value) => {
                            const nextIntentType = value || scriptOptions[0].intentType;
                            field.onChange(nextIntentType);
                            const args = watch("social.config.intent.args");
                            applyScriptDefaults(nextIntentType, scriptOptions, args, {
                              markDirty: true,
                            });
                          }}
                          placeholder="Select intent template"
                        >
                          {scriptOptions.map((option) => (
                            <SelectItem key={option.id} value={option.intentType}>
                              {option.name}
                            </SelectItem>
                          ))}
                        </ControlledSelect>
                      )}
                    />
                  )}
                  {loadingCatalog && (
                    <p className="text-xs text-muted-foreground">Loading gather scripts catalog...</p>
                  )}
                  <ErrorMessage>{getConfigErrorMessage("intent.type")}</ErrorMessage>
                  {selectedScript && (
                    <p className="text-xs text-muted-foreground">
                      {selectedScript.description}
                    </p>
                  )}
                  {scriptOptions.length === 0 && (
                    <div className="grid gap-2">
                      <p className="text-xs text-muted-foreground">
                        当前平台暂无可用 gather intent，可手动配置 intent.type 与 args。
                      </p>
                      <Input
                        placeholder="intent type (e.g. search)"
                        {...register("social.config.intent.type" as any)}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 border rounded-md p-3 bg-background">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Intent Args (key:value)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addArgRow}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>
                <div className="grid gap-2 max-h-56 overflow-y-auto pr-1">
                  {xArgRows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <Input
                        value={row.key}
                        onChange={(e) => updateArgRow(row.id, "key", e.target.value)}
                        placeholder="key (e.g. query)"
                        disabled={Boolean(row.preset)}
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => updateArgRow(row.id, "value", e.target.value)}
                        placeholder={row.description || "value"}
                      />
                      {!row.preset && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeArgRow(row.id)}
                          aria-label="Remove arg row"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {row.preset && (
                        <span className="text-xs text-muted-foreground text-right">
                          {row.required ? "required" : "optional"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  选择 intent template 后会自动填充推荐参数；你也可以新增自定义 key:value。
                </p>
                <ErrorMessage>{getConfigErrorMessage("intent.args")}</ErrorMessage>
              </div>
            </div>
          )}

          {resolvedDriver === "xhttp" && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              xhttp 驱动不需要浏览器参数，也不支持凭据上传/选择；将直接按 API 方式抓取。
            </div>
          )}

          {resolvedDriver === "agent-browser" && (
            renderAgentBrowserFields()
          )}
        </>
      )}

      {socialPlatform && renderDriverFilterFields()}
      {socialPlatform && renderDriverNetworkFields()}
          </CardContent>
        </Card>
      )}

      {socialPlatform && renderGatherOutputAndFilterFields()}

      {socialPlatform && requestPreview && (
        <Card className="gap-4 border-dashed bg-muted/20">
          <CardHeader>
            <CardTitle>Gather Request Preview</CardTitle>
            <CardDescription>
              当前表单将按这个请求体发送给 gather（keywords 由 Query 注入）。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-md bg-background p-3 text-xs leading-5">
              {JSON.stringify(requestPreview, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {socialPlatform === "REDDIT" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.subreddit">Subreddit</Label>
            <Input
              id="social.config.subreddit"
              placeholder="subreddit name"
              {...register("social.config.subreddit")}
            />
            <ErrorMessage>{getConfigErrorMessage("subreddit")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.sort">Sort</Label>
            <Input
              id="social.config.sort"
              placeholder="Sort"
              {...register("social.config.sort")}
            />
            <ErrorMessage>{getConfigErrorMessage("sort")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "XIAOHONGSHU" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.userId">用户 ID</Label>
            <Input
              id="social.config.userId"
              placeholder="小红书用户 ID"
              {...register("social.config.userId")}
            />
            <ErrorMessage>{getConfigErrorMessage("userId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.noteId">笔记 ID</Label>
            <Input
              id="social.config.noteId"
              placeholder="小红书笔记 ID"
              {...register("social.config.noteId")}
            />
            <ErrorMessage>{getConfigErrorMessage("noteId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">搜索关键词</Label>
            <Input
              id="social.config.query"
              placeholder="搜索关键词"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "DOUYIN" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.userId">用户 ID</Label>
            <Input
              id="social.config.userId"
              placeholder="抖音用户 ID 或 sec_uid"
              {...register("social.config.userId")}
            />
            <ErrorMessage>{getConfigErrorMessage("userId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.videoId">视频 ID</Label>
            <Input
              id="social.config.videoId"
              placeholder="抖音视频 ID"
              {...register("social.config.videoId")}
            />
            <ErrorMessage>{getConfigErrorMessage("videoId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">搜索关键词</Label>
            <Input
              id="social.config.query"
              placeholder="搜索关键词"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "TIKTOK" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.username">用户名</Label>
            <Input
              id="social.config.username"
              placeholder="TikTok 用户名 (不带 @)"
              {...register("social.config.username")}
            />
            <ErrorMessage>{getConfigErrorMessage("username")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.videoId">视频 ID</Label>
            <Input
              id="social.config.videoId"
              placeholder="TikTok 视频 ID"
              {...register("social.config.videoId")}
            />
            <ErrorMessage>{getConfigErrorMessage("videoId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">搜索关键词</Label>
            <Input
              id="social.config.query"
              placeholder="搜索关键词"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "WEIBO" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.userId">用户 ID</Label>
            <Input
              id="social.config.userId"
              placeholder="微博用户 ID (uid)"
              {...register("social.config.userId")}
            />
            <ErrorMessage>{getConfigErrorMessage("userId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">搜索关键词</Label>
            <Input
              id="social.config.query"
              placeholder="搜索关键词"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
          <div className="flex items-center gap-3">
            <Controller
              name="social.config.hotTopics"
              control={control}
              render={({ field }) => (
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={field.value || false}
                    onCheckedChange={field.onChange}
                  />
                  <span className="text-sm">获取热门话题</span>
                </label>
              )}
            />
          </div>
        </>
      )}

      {socialPlatform === "TELEGRAM" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.chatId">频道/群组 ID</Label>
            <Input
              id="social.config.chatId"
              placeholder="频道或群组的 ID 或用户名"
              {...register("social.config.chatId")}
            />
            <ErrorMessage>{getConfigErrorMessage("chatId")}</ErrorMessage>
            <p className="text-xs text-muted-foreground">
              留空则获取最近聊天记录
            </p>
          </div>
        </>
      )}

      {socialPlatform === "WHATSAPP" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.contactName">联系人/群组名称</Label>
            <Input
              id="social.config.contactName"
              placeholder="联系人或群组名称"
              {...register("social.config.contactName")}
            />
            <ErrorMessage>{getConfigErrorMessage("contactName")}</ErrorMessage>
            <p className="text-xs text-muted-foreground">
              留空则获取最近聊天记录。WhatsApp 使用持久化浏览器配置文件认证，首次需要扫描 QR 码。
            </p>
          </div>
        </>
      )}

      {socialPlatform === "INSTAGRAM" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.username">用户名</Label>
            <Input
              id="social.config.username"
              placeholder="Instagram 用户名"
              {...register("social.config.username")}
            />
            <ErrorMessage>{getConfigErrorMessage("username")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">搜索关键词</Label>
            <Input
              id="social.config.query"
              placeholder="搜索关键词"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.postId">帖子 ID</Label>
            <Input
              id="social.config.postId"
              placeholder="Instagram 帖子 ID"
              {...register("social.config.postId")}
            />
            <ErrorMessage>{getConfigErrorMessage("postId")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "FACEBOOK" && resolvedDriver !== "agent-browser" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.username">用户名 / 页面 ID</Label>
            <Input
              id="social.config.username"
              placeholder="Facebook 用户名 或 页面 ID"
              {...register("social.config.username")}
            />
            <ErrorMessage>{getConfigErrorMessage("username")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">搜索关键词</Label>
            <Input
              id="social.config.query"
              placeholder="搜索关键词"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.postId">帖子 ID</Label>
            <Input
              id="social.config.postId"
              placeholder="Facebook 帖子 ID"
              {...register("social.config.postId")}
            />
            <ErrorMessage>{getConfigErrorMessage("postId")}</ErrorMessage>
          </div>
        </>
      )}

      <AlertDialog
        open={!!credentialToDelete}
        onOpenChange={(open) => !open && setCredentialToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除凭据？</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要删除凭据 <span className="font-semibold text-foreground">"{credentialToDelete?.name}"</span> 吗？
              此操作无法撤销，删除后使用该凭据的采集任务控制可能失效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCredential}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
