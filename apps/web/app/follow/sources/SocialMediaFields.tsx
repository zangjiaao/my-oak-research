import { useState, useCallback } from "react";
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
import { ErrorMessage } from "@/components/business";
import SelectProxy from "./SelectProxy";
import { Proxy } from "@/app/generated/prisma";
import {
  SourceCreateSchema,
  SocialMediaSourceCreateSchema,
} from "@/app/api/_utils/zod";
import { Controller } from "react-hook-form";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { SocialPlatform } from "@/app/generated/prisma";
import {
  CheckCircle2,
  XCircle,
  Upload,
  Loader2,
  AlertCircle,
  FileJson,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

// Platforms that require cookie-based authentication
const COOKIE_AUTH_PLATFORMS = ["X", "XIAOHONGSHU"] as const;

export const SocialMediaFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
}: SocialMediaFieldsProps) => {
  const socialPlatform = watch("social.platform") as SocialPlatform | undefined;
  const socialErrors = errors as FieldErrors<
    z.infer<typeof SocialMediaSourceCreateSchema>
  >;
  const socialConfigErrors = socialErrors.social?.config as
    | FieldErrors<Record<string, unknown>>
    | undefined;

  // Auth state management
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ status: "idle" });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const getConfigErrorMessage = (key: string) => {
    const value = socialConfigErrors?.[key];
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

  // Handle file selection
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.json')) {
        setAuthStatus({
          status: "error",
          message: "请选择 .json 格式的文件",
        });
        return;
      }
      setSelectedFile(file);
      setAuthStatus({ status: "idle" });
    }
  }, []);

  // Handle auth file upload and verification
  const handleUploadAndVerify = useCallback(async () => {
    if (!selectedFile || !socialPlatform) return;

    setAuthStatus({ status: "uploading", message: "正在读取文件..." });

    try {
      // Read file content
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

      // Validate basic structure
      if (!authData.cookies || !Array.isArray(authData.cookies)) {
        setAuthStatus({
          status: "error",
          message: "无效的认证文件格式：缺少 cookies 字段",
        });
        return;
      }

      setAuthStatus({ status: "verifying", message: "正在验证认证信息..." });

      // Map platform name
      const platformName = socialPlatform === "X" ? "x" : socialPlatform.toLowerCase();

      // Call API to verify and save
      const response = await fetch(`/api/follow/sources/auth/${platformName}/cookie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authData }),
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

    } catch (error) {
      console.error("Auth upload error:", error);
      setAuthStatus({
        status: "error",
        message: error instanceof Error ? error.message : "上传验证失败",
      });
    }
  }, [selectedFile, socialPlatform]);

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
                // Reset auth status when platform changes
                setAuthStatus({ status: "idle" });
                setSelectedFile(null);
              }}
              placeholder="Select a social media platform"
            >
              {Object.values(SocialPlatform).map((platform) => (
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

      {/* Cookie Auth Upload Section */}
      {needsCookieAuth && (
        <div className="grid gap-3 p-4 border rounded-lg bg-muted/30">
          <div className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-muted-foreground" />
            <Label className="text-base font-medium">认证配置</Label>
          </div>

          <p className="text-sm text-muted-foreground">
            {socialPlatform === "X"
              ? "请上传从 Chrome 导出的 X.com 认证文件 (x_auth.json)"
              : "请上传从 Chrome 导出的小红书认证文件 (xiaohongshu_auth.json)"}
          </p>

          <div className="flex items-center gap-2 p-3 rounded-md border bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800">
            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              首先在 Chrome 中登录 {socialPlatform === "X" ? "X.com" : "小红书"}，
              然后运行 <code className="px-1 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/50">
                python export_chrome_cookies.py {socialPlatform === "X" ? "x" : "xiaohongshu"}
              </code> 导出 cookies
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Input
                type="file"
                accept=".json"
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

          {authStatus.status === "success" && authStatus.credentialId && (
            <p className="text-xs text-muted-foreground">
              认证 ID: {authStatus.credentialId}
            </p>
          )}
        </div>
      )}

      {socialPlatform === "X" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.user">User</Label>
            <Input
              id="social.config.user"
              placeholder="X User (e.g., @username)"
              {...register("social.config.user")}
            />
            <ErrorMessage>{getConfigErrorMessage("user")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.listId">List ID</Label>
            <Input
              id="social.config.listId"
              placeholder="X List ID"
              {...register("social.config.listId")}
            />
            <ErrorMessage>{getConfigErrorMessage("listId")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.query">Query</Label>
            <Input
              id="social.config.query"
              placeholder="Search query"
              {...register("social.config.query")}
            />
            <ErrorMessage>{getConfigErrorMessage("query")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "TELEGRAM" && (
        <>
          <div className="grid gap-3">
            <Label htmlFor="social.config.channel">Channel</Label>
            <Input
              id="social.config.channel"
              placeholder="@channel or channel_id"
              {...register("social.config.channel")}
            />
            <ErrorMessage>{getConfigErrorMessage("channel")}</ErrorMessage>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="social.config.mode">Mode</Label>
            <Input
              id="social.config.mode"
              placeholder="Mode"
              {...register("social.config.mode")}
            />
            <ErrorMessage>{getConfigErrorMessage("mode")}</ErrorMessage>
          </div>
        </>
      )}

      {socialPlatform === "REDDIT" && (
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

      {socialPlatform === "XIAOHONGSHU" && (
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

      <SelectProxy
        control={control}
        proxies={proxies}
        name="social.proxyId"
        error={socialErrors.social?.proxyId?.message?.toString()}
      />
    </>
  );
};
