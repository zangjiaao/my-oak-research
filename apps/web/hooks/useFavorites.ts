import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export type FavoriteItem = {
  id: string;
  title: string;
  summary: string;
  markdown: string;
  platform: string;
  time: string;
  url?: string | null;
  image?: string | null;
  type: string;
  favoriteId: string;
  favoritedAt: string;
};

type FavoritesResponse = {
  items: FavoriteItem[];
  nextCursor: string | null;
};

type FavoritesQuery = {
  platform?: string;
  search?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

const fetchFavorites = async (
  query: FavoritesQuery = {}
): Promise<FavoritesResponse> => {
  const params = new URLSearchParams();

  if (query.platform) {
    params.set("platform", query.platform);
  }
  if (query.search) {
    params.set("search", query.search);
  }
  if (query.from) {
    params.set("from", query.from);
  }
  if (query.to) {
    params.set("to", query.to);
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }

  const url = `/api/library/favorites${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch favorites");
  }
  return response.json();
};

export function useFavorites(query: FavoritesQuery = {}) {
  return useQuery({
    queryKey: ["favorites", query],
    queryFn: () => fetchFavorites(query),
    placeholderData: (prev) => prev,
    staleTime: 1000 * 60 * 5, // 5分钟内认为数据是新鲜的
  });
}

// 统一的 hook 来检查内容是否已收藏
export function useIsFavorite(contentId: string): boolean {
  const queryClient = useQueryClient();

  // 从所有 favorites 查询中查找
  const allFavoritesQueries = queryClient.getQueriesData<FavoritesResponse>({
    queryKey: ["favorites"],
  });

  for (const [, data] of allFavoritesQueries) {
    if (data?.items.some((item) => item.id === contentId)) {
      return true;
    }
  }

  return false;
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contentId,
      isFavorite,
    }: {
      contentId: string;
      isFavorite: boolean;
    }) => {
      const endpoint = "/api/focus-bulletin/favorites";
      const method = isFavorite ? "DELETE" : "POST";
      const url = isFavorite
        ? `${endpoint}?contentId=${encodeURIComponent(contentId)}`
        : endpoint;

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify({ contentId }) : undefined,
      });

      // 处理特殊情况：如果已经收藏（409 Conflict），视为成功
      if (response.status === 409) {
        const errorData = await response.json().catch(() => ({}));
        // 如果错误消息是 "Already favorited"，说明已经达到目标状态，视为成功
        if (
          errorData.error === "Already favorited" ||
          errorData.error?.includes("Already")
        ) {
          return { success: true, alreadyExists: true };
        }
      }

      // 处理删除时找不到的情况（404），也视为成功（幂等性）
      if (response.status === 404 && isFavorite) {
        return { success: true, alreadyDeleted: true };
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to toggle favorite");
      }

      return response.json();
    },
    // 乐观更新：在 API 调用前立即更新 UI
    onMutate: async ({ contentId, isFavorite }) => {
      // 取消所有正在进行的查询，避免覆盖乐观更新
      await queryClient.cancelQueries({ queryKey: ["favorites"] });
      await queryClient.cancelQueries({ queryKey: ["follow-content"] });

      // 保存所有 favorites 查询的缓存数据，用于回滚
      const previousQueries = queryClient.getQueriesData<FavoritesResponse>({
        queryKey: ["favorites"],
      });

      // 尝试从 follow-content 查询中获取内容信息
      const followContentQueries = queryClient.getQueriesData<{
        items: Array<{
          id: string;
          title: string;
          summary: string;
          markdown: string;
          platform: string;
          time: string;
          url?: string | null;
          image?: string | null;
          type: string;
        }>;
      }>({
        queryKey: ["follow-content"],
      });

      let contentInfo: FavoriteItem | null = null;
      for (const [, data] of followContentQueries) {
        const item = data?.items?.find((item) => item.id === contentId);
        if (item) {
          contentInfo = {
            id: item.id,
            title: item.title,
            summary: item.summary,
            markdown: item.markdown,
            platform: item.platform,
            time: item.time,
            url: item.url,
            image: item.image,
            type: item.type,
            favoriteId: `temp-${contentId}`, // 临时 ID
            favoritedAt: new Date().toISOString(),
          };
          break;
        }
      }

      // 乐观更新：更新所有 favorites 查询的缓存
      queryClient.setQueriesData<FavoritesResponse>(
        { queryKey: ["favorites"] },
        (old) => {
          if (!old) {
            // 如果没有缓存，创建一个新的
            if (isFavorite) {
              return { items: [], nextCursor: null };
            }
            if (contentInfo) {
              return { items: [contentInfo], nextCursor: null };
            }
            return { items: [], nextCursor: null };
          }

          if (isFavorite) {
            // 删除收藏：从列表中移除
            return {
              ...old,
              items: old.items.filter((item) => item.id !== contentId),
            };
          } else {
            // 添加收藏：检查是否已存在
            const existingItem = old.items.find(
              (item) => item.id === contentId
            );
            if (existingItem) {
              return old; // 如果已存在，不重复添加
            }
            // 如果有内容信息，添加到列表开头
            if (contentInfo) {
              return {
                ...old,
                items: [contentInfo, ...old.items],
              };
            }
            return old;
          }
        }
      );

      return { previousQueries };
    },
    onSuccess: (data, variables) => {
      // 如果已经存在或已删除，不显示提示，只刷新缓存
      if (data?.alreadyExists || data?.alreadyDeleted) {
        queryClient.invalidateQueries({ queryKey: ["favorites"] });
        queryClient.invalidateQueries({ queryKey: ["follow-content"] });
        return;
      }

      toast.success(variables.isFavorite ? "已取消收藏" : "已添加到收藏夹");
      // 使收藏列表和关注内容列表的缓存失效，获取最新数据
      queryClient.invalidateQueries({
        queryKey: ["favorites"],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["follow-content"],
        refetchType: "all",
      });
    },
    onError: (error: Error, variables, context) => {
      console.error("Failed to toggle favorite:", error);

      // 回滚所有 favorites 查询的乐观更新
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }

      toast.error(error.message || "操作失败");
    },
  });
}
