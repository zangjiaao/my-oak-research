const PROMPT_MARKERS = [
  "system:",
  "assistant:",
  "developer:",
  "ignore previous",
  "forget previous",
];

export function stripPromptLike(input: string) {
  if (!input) return input;
  let sanitized = input;
  PROMPT_MARKERS.forEach((marker) => {
    const regex = new RegExp(`${marker}.*`, "gi");
    sanitized = sanitized.replace(regex, "");
  });
  return sanitized.trim();
}

const SENSITIVE_KEYS = [
  "token",
  "secret",
  "password",
  "authorization",
  "apiKey",
  "api_key",
];

export function redact<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.map((item) => redact(item)) as unknown as T;
  }

  if (typeof data === "object" && data !== null) {
    const copy: Record<string, unknown> = {};
    Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s))) {
        copy[key] = "***";
      } else {
        copy[key] = redact(value);
      }
    });
    return copy as T;
  }

  return data;
}
