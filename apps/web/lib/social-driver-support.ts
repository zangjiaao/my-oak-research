export type SocialDriver = "xhttp" | "playwright";
export type KnownSocialPlatform =
  | "X"
  | "REDDIT"
  | "XIAOHONGSHU"
  | "DOUYIN"
  | "TIKTOK"
  | "WEIBO"
  | "WHATSAPP"
  | "INSTAGRAM"
  | "FACEBOOK";

export const SOCIAL_PLATFORM_DRIVER_SUPPORT: Record<KnownSocialPlatform, readonly SocialDriver[]> = {
  X: ["playwright"],
  REDDIT: ["playwright", "xhttp"],
  XIAOHONGSHU: ["playwright"],
  DOUYIN: ["playwright", "xhttp"],
  TIKTOK: ["playwright", "xhttp"],
  WEIBO: ["playwright", "xhttp"],
  WHATSAPP: ["playwright", "xhttp"],
  INSTAGRAM: ["playwright", "xhttp"],
  FACEBOOK: ["playwright", "xhttp"],
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
