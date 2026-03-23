import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface UseQueryMutationOptions {
  queryId?: string;
  onSuccess?: () => void;
}

async function submitQuery(data: {
  formData: Record<string, unknown>;
  endpoint: string;
  isUpdate: boolean;
}) {
  const { formData, endpoint, isUpdate } = data;

  const response = await fetch(endpoint, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(formData),
  });

  if (!response.ok) {
    let errorMessage = "";
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await response.json()) as
        | { error?: string; message?: string; details?: unknown }
        | undefined;
      errorMessage =
        json?.error ||
        json?.message ||
        (typeof json?.details === "string"
          ? json.details
          : json?.details
            ? JSON.stringify(json.details)
            : "");
    } else {
      errorMessage = (await response.text()).trim();
    }

    throw new Error(
      errorMessage ||
        `Failed to submit query (HTTP ${response.status} ${response.statusText})`
    );
  }

  return response.json();
}

export function useQueryMutation({
  queryId,
  onSuccess,
}: UseQueryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const isUpdate = !!queryId;
  const endpoint = queryId
    ? `/api/follow/queries/${queryId}`
    : "/api/follow/queries";

  return useMutation({
    mutationFn: (formData: Record<string, unknown>) =>
      submitQuery({
        formData,
        endpoint,
        isUpdate,
      }),
    onSuccess: () => {
      toast.success(
        isUpdate ? "Query updated successfully" : "Query added successfully"
      );
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["queries"] });
    },
    onError: (error: Error) => {
      console.error("Failed to submit query:", error);
      toast.error(
        error.message ||
          (isUpdate ? "Failed to update query" : "Failed to add query")
      );
    },
  });
}

export function useDeleteQueryMutation({
  onSuccess,
}: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (queryId: string) => {
      const response = await fetch(`/api/follow/queries/${queryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete query");
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("Query deleted successfully");
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["queries"] });
    },
    onError: (error: Error) => {
      console.error("Failed to delete query:", error);
      toast.error(error.message || "Failed to delete query");
    },
  });
}
