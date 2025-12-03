/**
 * 统一的 API Fetcher
 * 处理统一的响应结构和错误处理
 */

export async function apiFetcher(input: string | URL, init?: RequestInit) {
  const res = await fetch(input, { ...init, credentials: "include" });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.success === false) {
    const err = {
      status: res.status,
      code: json?.error?.code ?? "INTERNAL",
      message: json?.error?.message ?? "Request failed",
    };
    throw err;
  }

  return json?.data ?? json;
}
