import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SourceType } from "@/app/generated/prisma";

// Helper to get the correct API endpoint based on source type
const getApiEndpoint = (type: SourceType, id?: string) => {
  if (id) {
    // For updates, the endpoint is /api/follow/sources/{id}
    return `/api/follow/sources/${id}`;
  } else {
    // For creations, the endpoint is /api/follow/sources
    // The source type is passed in the body
    return `/api/follow/sources`;
  }
};

interface UseSourceMutationOptions {
  sourceId?: string;
  sourceType: SourceType; // Make sourceType mandatory
  onSuccess?: () => void;
}

async function submitSource(data: {
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
    const errorBody = await response.text(); // Read the body once
    let errorMessage = "Failed to submit source";
    try {
      const errorData = JSON.parse(errorBody);
      errorMessage = errorData.message || JSON.stringify(errorData);
    } catch {
      errorMessage = errorBody;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export function useSourceMutation({
  sourceId,
  sourceType,
  onSuccess,
}: UseSourceMutationOptions) {
  const queryClient = useQueryClient();
  const isUpdate = !!sourceId;
  const endpoint = getApiEndpoint(sourceType, sourceId);

  return useMutation({
    mutationFn: (formData: Record<string, unknown>) =>
      submitSource({
        formData,
        endpoint,
        isUpdate,
      }),
    onSuccess: () => {
      toast.success(
        isUpdate ? "Source updated successfully" : "Source added successfully"
      );
      onSuccess?.();

      // With useFollow, we only need to invalidate the main 'sources' query
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error: Error) => {
      console.error("Failed to submit source:", error);
      toast.error(
        error.message ||
          (isUpdate ? "Failed to update source" : "Failed to add source")
      );
    },
  });
}
