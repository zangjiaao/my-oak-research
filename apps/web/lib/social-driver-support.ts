export type SocialDriver = "xhttp" | "playwright" | "agent-browser";
export type KnownSocialPlatform =
  | "X"
  | "REDDIT"
  | "XIAOHONGSHU"
  | "DOUYIN"
  | "TIKTOK"
  | "WEIBO"
  | "TELEGRAM"
  | "WHATSAPP"
  | "INSTAGRAM"
  | "FACEBOOK";

export const SOCIAL_PLATFORM_DRIVER_SUPPORT: Record<KnownSocialPlatform, readonly SocialDriver[]> = {
  X: ["playwright", "agent-browser"],
  REDDIT: ["playwright", "xhttp", "agent-browser"],
  XIAOHONGSHU: ["agent-browser"],
  DOUYIN: ["playwright", "xhttp", "agent-browser"],
  TIKTOK: ["playwright", "xhttp", "agent-browser"],
  WEIBO: ["playwright", "xhttp", "agent-browser"],
  TELEGRAM: ["agent-browser"],
  WHATSAPP: ["playwright", "xhttp", "agent-browser"],
  INSTAGRAM: ["playwright", "xhttp", "agent-browser"],
  FACEBOOK: ["playwright", "xhttp", "agent-browser"],
};

export function getSupportedDrivers(platform: string): readonly SocialDriver[] {
  const normalized = platform.toUpperCase() as KnownSocialPlatform;
  return SOCIAL_PLATFORM_DRIVER_SUPPORT[normalized] ?? ["playwright"];
}

export function getDefaultDriver(platform: string): SocialDriver {
  return getSupportedDrivers(platform)[0] ?? "playwright";
}

export function supportsDriver(platform: string, driver: string): driver is SocialDriver {
  return getSupportedDrivers(platform).includes(driver as SocialDriver);
}
