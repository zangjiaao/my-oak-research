import { SourceWithRelations } from "@/lib/types";
import { sourceHasLockedRecallArgs } from "@/lib/source-recall-binding";

export const QUICK_RUN_LOCKED_ARG_MESSAGE =
  "该来源存在锁定 arg（recall binding），不支持快速执行";

type QuickRunResponse = {
  queryId: string;
  runId: string;
  created: boolean;
};

export function isSourceQuickRunUnsupported(source: SourceWithRelations): boolean {
  return sourceHasLockedRecallArgs(source);
}

export async function quickRunSource(sourceId: string): Promise<QuickRunResponse> {
  const response = await fetch(`/api/follow/sources/${sourceId}/quick-run`, {
    method: "POST",
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let message = "Failed to quick run source";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as
        | { error?: string; message?: string }
        | undefined;
      message = payload?.error || payload?.message || message;
    } else {
      const text = (await response.text()).trim();
      if (text) message = text;
    }
    throw new Error(message);
  }

  return (await response.json()) as QuickRunResponse;
}
