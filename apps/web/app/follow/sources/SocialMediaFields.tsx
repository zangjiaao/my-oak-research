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

export const SocialMediaFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
  setValue,
}: SocialMediaFieldsProps) => {
  const socialPlatform = watch("social.platform") as SocialPlatform | undefined;
  const currentCredentialId = watch("social.credentialId") as string | null | undefined;

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

  // Fetch existing credentials when platform changes
  useEffect(() => {
    if (!needsCookieAuth || !socialPlatform) {
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
  }, [socialPlatform, needsCookieAuth]);

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
                // Reset auth status and credential when platform changes
                setAuthStatus({ status: "idle" });
                setSelectedFile(null);
                setShowUploadForm(false);
                if (setValue) {
                  setValue("social.credentialId", null);
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

      {/* Cookie Auth Selection Section */}
      {needsCookieAuth && (
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

      {socialPlatform === "DOUYIN" && (
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

      {socialPlatform === "TIKTOK" && (
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

      {socialPlatform === "WEIBO" && (
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

      {socialPlatform === "TELEGRAM" && (
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

      {socialPlatform === "WHATSAPP" && (
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

      {socialPlatform === "INSTAGRAM" && (
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

      {socialPlatform === "FACEBOOK" && (
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
