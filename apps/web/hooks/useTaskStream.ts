import { useEffect } from "react";

export function useTaskStream<T = unknown>(
  runId: string | undefined,
  onEvent: (e: T) => void
) {
  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/tasks/${runId}/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as T;
        onEvent(data);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // keep silent; browser will auto-retry
    };
    return () => {
      es.close();
    };
  }, [runId, onEvent]);
}
