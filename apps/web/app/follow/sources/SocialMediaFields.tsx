import { useState, useCallback, useEffect } from "react";
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
import { SocialPlatform } from "@/app/generated/prisma";
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

// Platforms that require cookie-based authentication
const COOKIE_AUTH_PLATFORMS = ["X", "XIAOHONGSHU", "REDDIT", "DOUYIN", "TIKTOK", "WEIBO", "TELEGRAM", "WHATSAPP", "INSTAGRAM", "FACEBOOK"] as const;

// Map platform to credential kind
const PLATFORM_TO_KIND: Record<string, string> = {
  "X": "x-cookie",
  "XIAOHONGSHU": "xiaohongshu-cookie",
  "REDDIT": "reddit-cookie",
  "DOUYIN": "douyin-cookie",
  "TIKTOK": "tiktok-cookie",
  "WEIBO": "weibo-cookie",
  "TELEGRAM": "telegram-cookie",
  "WHATSAPP": "whatsapp-profile",
  "INSTAGRAM": "instagram-cookie",
  "FACEBOOK": "facebook-cookie",
};

type XScriptArg = {
  required: boolean;
  description: string;
};

type XScriptOption = {
  name: string;
  description: string;
  domain: string;
  scriptPath: string;
  args: Record<string, XScriptArg>;
};

const X_SCRIPT_OPTIONS: XScriptOption[] = [
  {
    name: "twitter/tweets",
    description: "获取用户最近的推文（时间线）",
    domain: "x.com",
    scriptPath: "/Users/zangjiaao/Reference/bb-sites/twitter/tweets.js",
    args: {
      screen_name: {
        required: true,
        description: "Twitter handle (without @)",
      },
      count: {
        required: false,
        description: "Number of tweets (default 20, max 100)",
      },
    },
  },
  {
    name: "twitter/thread",
    description: "获取推文对话线程（原文 + 所有回复）",
    domain: "x.com",
    scriptPath: "/Users/zangjiaao/Reference/bb-sites/twitter/thread.js",
    args: {
      tweet_id: {
        required: true,
        description: "Tweet ID (numeric) or full URL",
      },
    },
  },
  {
    name: "twitter/search",
    description: "搜索推文",
    domain: "x.com",
    scriptPath: "/Users/zangjiaao/Reference/bb-sites/twitter/search.js",
    args: {
      query: {
        required: true,
        description: "Search query",
      },
      count: {
        required: false,
        description: "Number of results (default 20, max 50)",
      },
      type: {
        required: false,
        description: "Result type: latest (default) or top",
      },
    },
  },
];

const DEFAULT_X_SCRIPT = X_SCRIPT_OPTIONS[0];

type PlaywrightArgRow = {
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

const createEmptyArgRow = (): PlaywrightArgRow => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  key: "",
  value: "",
});

const createEmptyAgentScriptRow = (): AgentScriptRow => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  json: "",
});

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

const getXScriptOptionByPath = (scriptPath?: string | null) =>
  X_SCRIPT_OPTIONS.find((item) => item.scriptPath === scriptPath) ?? DEFAULT_X_SCRIPT;

const buildXArgRows = (
  args: Record<string, string>,
  script: XScriptOption
): PlaywrightArgRow[] => {
  const rows: PlaywrightArgRow[] = [];
  const included = new Set<string>();

  for (const [key, rule] of Object.entries(script.args)) {
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

export const SocialMediaFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
  setValue,
}: SocialMediaFieldsProps) => {
  const socialPlatform = watch("social.platform") as SocialPlatform | undefined;
  const selectedDriver = watch("social.config.driver") as string | undefined;
  const currentCredentialId = watch("social.credentialId") as string | null | undefined;
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
  const [xArgRows, setXArgRows] = useState<PlaywrightArgRow[]>([
    createEmptyArgRow(),
  ]);
  const [agentScriptRows, setAgentScriptRows] = useState<AgentScriptRow[]>([
    createEmptyAgentScriptRow(),
  ]);

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
  const needsCookieAuth = socialPlatform &&
    COOKIE_AUTH_PLATFORMS.includes(socialPlatform as typeof COOKIE_AUTH_PLATFORMS[number]);
  const supportsCredentialForDriver =
    resolvedDriver !== "xhttp";
  const canUseCredential = Boolean(needsCookieAuth && supportsCredentialForDriver);

  // Fetch existing credentials when platform changes
  useEffect(() => {
    if (!canUseCredential || !socialPlatform) {
      setCredentials([]);
      return;
    }

    const fetchCredentials = async () => {
      setLoadingCredentials(true);
      try {
        const kind = PLATFORM_TO_KIND[socialPlatform];
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
    if (!setValue) return;
    if (socialPlatform && resolvedDriver === "xhttp") {
      setValue("social.credentialId", null, { shouldDirty: true });
      setShowUploadForm(false);
      setSelectedFile(null);
      setAuthStatus({ status: "idle" });
    }
  }, [setValue, socialPlatform, resolvedDriver]);

  const syncArgsToForm = useCallback(
    (rows: PlaywrightArgRow[]) => {
      if (!setValue) return;
      const args = rows.reduce<Record<string, string>>((acc, row) => {
        const key = row.key.trim();
        if (!key) return acc;
        acc[key] = row.value;
        return acc;
      }, {});
      setValue("social.config.playwright.args", args, { shouldDirty: true });
    },
    [setValue]
  );

  const applyXScriptDefaults = useCallback(
    (
      scriptPath: string,
      incomingArgs: unknown,
      options?: {
        markDirty?: boolean;
      }
    ) => {
      if (!setValue) return;
      const script = getXScriptOptionByPath(scriptPath);
      const currentArgs = normalizeArgs(incomingArgs);
      const nextArgs = Object.fromEntries(
        Object.keys(script.args).map((argKey) => [argKey, currentArgs[argKey] ?? ""])
      );
      const rows = buildXArgRows(nextArgs, script);
      setValue("social.config.playwright.scriptPath", script.scriptPath, {
        shouldDirty: options?.markDirty ?? false,
      });
      setValue("social.config.playwright.args", nextArgs, {
        shouldDirty: options?.markDirty ?? false,
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
    if (socialPlatform !== "X") return;
    const scriptPath = watch("social.config.playwright.scriptPath");
    const normalizedScriptPath = scriptPath || DEFAULT_X_SCRIPT.scriptPath;
    const rawArgs = watch("social.config.playwright.args");
    applyXScriptDefaults(normalizedScriptPath, rawArgs);
  }, [socialPlatform, watch, applyXScriptDefaults]);

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
        const kind = PLATFORM_TO_KIND[socialPlatform];
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
      const kind = PLATFORM_TO_KIND[socialPlatform];
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
  const selectedXScriptPath = watch("social.config.playwright.scriptPath") as
    | string
    | undefined;
  const selectedXScript = getXScriptOptionByPath(selectedXScriptPath);
  const keywordFilterError =
    getConfigErrorMessage("keywordFilter.keywords") ??
    getConfigErrorMessage("keywordFilter");
  const responseFormatsError = getConfigErrorMessage("responseFormats");

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
    <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
      <Label className="text-base font-medium">Agent Browser Params</Label>
      <p className="text-xs text-muted-foreground">
        ownerId / sessionKey 由系统统一维护，表单无需填写。
      </p>

      <div className="flex flex-wrap items-center gap-5">
        <Controller
          name="social.config.agentBrowser.headed"
          control={control}
          render={({ field }) => (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Headed</span>
            </label>
          )}
        />
        <Controller
          name="social.config.agentBrowser.closeOnComplete"
          control={control}
          render={({ field }) => (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Close On Complete</span>
            </label>
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
          <Input
            id="social.config.agentBrowser.captureFilter.keys"
            placeholder="messages_text"
            {...register("social.config.agentBrowser.captureFilter.keys")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Controller
          name="social.config.agentBrowser.captureFilter.perLine"
          control={control}
          render={({ field }) => (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Capture Per Line</span>
            </label>
          )}
        />
        <Controller
          name="social.config.agentBrowser.captureFilter.dedupe"
          control={control}
          render={({ field }) => (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Capture Dedupe</span>
            </label>
          )}
        />
      </div>
    </div>
  );

  const renderGatherOutputAndFilterFields = () => (
    <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
      <Label className="text-base font-medium">Gather Output & Keyword Filter</Label>

      <div className="grid gap-2">
        <Label>Response Formats</Label>
        <Controller
          name="social.config.responseFormats"
          control={control}
          render={({ field }) => {
            const selected = Array.isArray(field.value) && field.value.length > 0
              ? field.value
              : ["text", "markdown"];
            const toggle = (format: "text" | "markdown", checked: boolean) => {
              const next = checked
                ? Array.from(new Set([...selected, format]))
                : selected.filter((value) => value !== format);
              field.onChange(next.length > 0 ? next : [format]);
            };
            return (
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes("text")}
                    onChange={(e) => toggle("text", e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">text</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.includes("markdown")}
                    onChange={(e) => toggle("markdown", e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">markdown</span>
                </label>
              </div>
            );
          }}
        />
        <ErrorMessage>{responseFormatsError}</ErrorMessage>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="social.config.keywordFilter.keywords">Keywords</Label>
        <Controller
          name="social.config.keywordFilter.keywords"
          control={control}
          render={({ field }) => (
            <Textarea
              id="social.config.keywordFilter.keywords"
              rows={3}
              placeholder="关键词，使用逗号或换行分隔"
              value={
                Array.isArray(field.value)
                  ? field.value.join("\n")
                  : typeof field.value === "string"
                    ? field.value
                    : ""
              }
              onChange={(e) => field.onChange(e.target.value)}
            />
          )}
        />
        <ErrorMessage>{keywordFilterError}</ErrorMessage>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="grid gap-2">
          <Label>Match Scope</Label>
          <Controller
            name="social.config.keywordFilter.matchScope"
            control={control}
            render={({ field }) => (
              <ControlledSelect
                value={(field.value as string) || "segment"}
                onValueChange={field.onChange}
                placeholder="Select match scope"
              >
                <SelectItem value="segment">segment</SelectItem>
                <SelectItem value="full">full</SelectItem>
              </ControlledSelect>
            )}
          />
        </div>
        <div className="grid gap-2">
          <Label>Split Mode</Label>
          <Controller
            name="social.config.keywordFilter.splitMode"
            control={control}
            render={({ field }) => (
              <ControlledSelect
                value={(field.value as string) || "line"}
                onValueChange={field.onChange}
                placeholder="Select split mode"
              >
                <SelectItem value="line">line</SelectItem>
                <SelectItem value="paragraph">paragraph</SelectItem>
                <SelectItem value="auto">auto</SelectItem>
              </ControlledSelect>
            )}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="social.config.keywordFilter.minSegmentChars">
            Min Segment Chars
          </Label>
          <Input
            id="social.config.keywordFilter.minSegmentChars"
            type="number"
            min={0}
            {...register("social.config.keywordFilter.minSegmentChars", {
              setValueAs: (value) => (value === "" ? undefined : Number(value)),
            })}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="grid gap-3">
        <Label htmlFor="social.platform">Platform</Label>
        <Controller
          name="social.platform"
          control={control}
          render={({ field }) => (
            <ControlledSelect
              value={field.value as string}
              onValueChange={(value) => {
                field.onChange(value);
                // Reset auth status and credential when platform changes
                setAuthStatus({ status: "idle" });
                setSelectedFile(null);
                setShowUploadForm(false);
                if (setValue) {
                  setValue("social.credentialId", null);
                  if (value === "X") {
                    setValue("social.config.driver", getDefaultDriver("X"));
                    setValue("social.config.playwright.mode", "eval-js");
                    setValue("social.config.playwright.headless", false);
                    setValue("social.config.playwright.targetUrl", "");
                    setValue(
                      "social.config.playwright.scriptPath",
                      DEFAULT_X_SCRIPT.scriptPath
                    );
                    setValue("social.config.playwright.args", {});
                  } else {
                    setValue(
                      "social.config.driver",
                      getDefaultDriver(value as SocialPlatform)
                    );
                  }
                }
              }}
              placeholder="Select a social media platform"
            >
              {SocialPlatformEnum.options.map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {platform}
                </SelectItem>
              ))}
            </ControlledSelect>
          )}
        />
        <ErrorMessage>
          {socialErrors.social?.platform?.message?.toString()}
        </ErrorMessage>
      </div>

      {socialPlatform && supportedDrivers.length > 0 && (
        <div className="grid gap-3">
          <Label>Driver</Label>
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
        <div className="grid gap-3 p-4 border rounded-lg bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              <Label className="text-base font-medium">认证凭证</Label>
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

      {socialPlatform === "X" && (
        <>
          {resolvedDriver === "playwright" && (
            <div className="grid gap-4 p-4 border rounded-lg bg-muted/30">
              <Label className="text-base font-medium">Playwright Task Params (Required)</Label>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-3">
                  <Label htmlFor="social.config.playwright.mode">Mode</Label>
                  <Controller
                    name="social.config.playwright.mode"
                    control={control}
                    render={({ field }) => (
                      <ControlledSelect
                        value={(field.value as string) || "eval-js"}
                        onValueChange={field.onChange}
                        placeholder="Select mode"
                      >
                        <SelectItem value="eval-js">eval-js</SelectItem>
                      </ControlledSelect>
                    )}
                  />
                </div>

                <div className="flex items-center gap-3 pt-8">
                  <Controller
                    name="social.config.playwright.headless"
                    control={control}
                    render={({ field }) => (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(field.value)}
                          onChange={(e) => field.onChange(e.target.checked)}
                          className="rounded border-gray-300"
                        />
                        <span className="text-sm">Headless</span>
                      </label>
                    )}
                  />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="social.config.playwright.targetUrl">Target URL (Optional)</Label>
                  <Input
                    id="social.config.playwright.targetUrl"
                    placeholder="留空则不执行 page.goto()"
                    {...register("social.config.playwright.targetUrl")}
                  />
                  <ErrorMessage>{getConfigErrorMessage("playwright.targetUrl")}</ErrorMessage>
                </div>

                <div className="grid gap-3 md:col-span-2">
                  <Label htmlFor="social.config.playwright.scriptPath">Script Template</Label>
                  <Controller
                    name="social.config.playwright.scriptPath"
                    control={control}
                    render={({ field }) => (
                      <ControlledSelect
                        value={(field.value as string) || DEFAULT_X_SCRIPT.scriptPath}
                        onValueChange={(value) => {
                          const nextScriptPath = value || DEFAULT_X_SCRIPT.scriptPath;
                          field.onChange(nextScriptPath);
                          const args = watch("social.config.playwright.args");
                          applyXScriptDefaults(nextScriptPath, args, { markDirty: true });
                        }}
                        placeholder="Select script path"
                      >
                        {X_SCRIPT_OPTIONS.map((option) => (
                          <SelectItem key={option.scriptPath} value={option.scriptPath}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </ControlledSelect>
                    )}
                  />
                  <ErrorMessage>{getConfigErrorMessage("playwright.scriptPath")}</ErrorMessage>
                  <p className="text-xs text-muted-foreground">
                    {selectedXScript.description}
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="social.config.playwright.scriptPath-input">
                      Script Path (Editable)
                    </Label>
                    <Input
                      id="social.config.playwright.scriptPath-input"
                      placeholder="/Users/zangjiaao/Reference/bb-sites/twitter/tweets.js"
                      {...register("social.config.playwright.scriptPath")}
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 border rounded-md p-3 bg-background">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Args (key:value)</Label>
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
                        placeholder="key (e.g. screen_name)"
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
                  预设参数随脚本切换自动调整；你也可以新增自定义 key:value。
                </p>
                <ErrorMessage>{getConfigErrorMessage("playwright.args")}</ErrorMessage>
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

      {socialPlatform && socialPlatform !== "X" && resolvedDriver === "xhttp" && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          xhttp 驱动不需要浏览器参数，也不支持凭据上传/选择；将直接按 API 方式抓取。
        </div>
      )}

      {socialPlatform && socialPlatform !== "X" && resolvedDriver === "agent-browser" && (
        renderAgentBrowserFields()
      )}

      {socialPlatform && renderGatherOutputAndFilterFields()}

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
                  <input
                    type="checkbox"
                    checked={field.value || false}
                    onChange={(e) => field.onChange(e.target.checked)}
                    className="rounded border-gray-300"
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

      <SelectProxy
        control={control}
        proxies={proxies}
        name="social.proxyId"
        error={socialErrors.social?.proxyId?.message?.toString()}
      />

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
