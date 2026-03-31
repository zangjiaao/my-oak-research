import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface UseTopicMutationOptions {
  topicId?: string;
  onSuccess?: () => void;
}

export function useTopicMutation({
  topicId,
  onSuccess,
}: UseTopicMutationOptions = {}) {
  const queryClient = useQueryClient();
  const isUpdate = !!topicId;
  const endpoint = topicId ? `/api/follow/topics/${topicId}` : "/api/follow/topics";

  return useMutation({
    mutationFn: async (formData: Record<string, unknown>) => {
      const response = await fetch(endpoint, {
        method: isUpdate ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        let message = "";
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { error?: string; message?: string };
          message = payload.error || payload.message || "";
        } else {
          message = (await response.text()).trim();
        }
        throw new Error(message || "Failed to submit topic");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success(isUpdate ? "Topic updated successfully" : "Topic added successfully");
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || (isUpdate ? "Failed to update topic" : "Failed to add topic"));
    },
  });
}

export function useDeleteTopicMutation({ onSuccess }: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topicId: string) => {
      const response = await fetch(`/api/follow/topics/${topicId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete topic");
      }
      return true;
    },
    onSuccess: () => {
      toast.success("Topic deleted successfully");
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete topic");
    },
  });
}
