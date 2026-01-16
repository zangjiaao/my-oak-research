"use client";

import { Source } from "@/app/generated/prisma";
import { DeleteAlert } from "@/components/common";

interface Props {
  source: Source;
  triggerButton: React.ReactNode;
  queryKeyType?: string; // 用于指定要 invalidate 的查询类型，如 "DARKNET", "WEB", "SOCIAL_MEDIA" 等
}

const SourceDeleteAlert = ({ source, triggerButton, queryKeyType }: Props) => {
  // 构建查询键数组，包含通用和特定类型的查询键
  const queryKeys = [
    ["sources"], // 通用 sources 列表
    ...(queryKeyType ? [["sources", queryKeyType]] : []), // 特定类型的 sources
  ];

  return (
    <DeleteAlert
      item={source}
      itemName="name"
      title="Delete Source"
      description={(item) =>
        `Are you sure you want to delete "${item.name}" source? This action cannot be undone.`
      }
      queryKeys={queryKeys}
      deleteEndpoint={(id) => `/api/follow/sources/${id}`}
      triggerButton={triggerButton}
    />
  );
};

export default SourceDeleteAlert;
