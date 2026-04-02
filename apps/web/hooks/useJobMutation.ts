import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type JobMutationError = Error & {
  status?: number;
  field?: string;
};

interface UseJobMutationOptions {
  jobId?: string;
  onSuccess?: () => void;
}

export function useJobMutation({ jobId, onSuccess }: UseJobMutationOptions = {}) {
  const queryClient = useQueryClient();
  const isUpdate = !!jobId;
  const endpoint = jobId ? `/api/follow/jobs/${jobId}` : "/api/follow/jobs";

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
        let field: string | undefined;
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as {
            error?: string;
            message?: string;
            field?: string;
          };
          message = payload.error || payload.message || "";
          field = payload.field;
        } else {
          message = (await response.text()).trim();
        }
        const error = new Error(message || "Failed to submit job") as JobMutationError;
        error.status = response.status;
        error.field = field;
        throw error;
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success(isUpdate ? "Job updated successfully" : "Job added successfully");
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: JobMutationError) => {
      toast.error(error.message || (isUpdate ? "Failed to update job" : "Failed to add job"));
    },
  });
}

export function useDeleteJobMutation({ onSuccess }: { onSuccess?: () => void } = {}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/follow/jobs/${jobId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete job");
      }
      return true;
    },
    onSuccess: () => {
      toast.success("Job deleted successfully");
      onSuccess?.();
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete job");
    },
  });
}
