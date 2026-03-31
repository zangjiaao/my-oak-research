"use client";

import { Category, Prisma } from "@/app/generated/prisma";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import EditKeywordDialog from "./KeywordDialog";
import DeleteKeywordDialog from "./KeywordAlert";

type KeywordWithCategory = Prisma.KeywordGetPayload<{
  include: { category: true };
}>;

const LANGUAGE_LABELS: Record<string, string> = {
  zh: "Chinese (zh)",
  en: "English (en)",
  ja: "Japanese (ja)",
  auto: "Auto (auto)",
};

const KeywordsTable = ({
  keywords,
  categories,
}: {
  keywords: KeywordWithCategory[];
  categories: Category[];
}) => {
  // 定义表格列配置
  const columns: DataTableColumn<KeywordWithCategory>[] = [
    {
      key: "name",
      label: "Name",
      render: (keyword) => keyword.name,
    },
    {
      key: "category",
      label: "Category",
      hideBelow: "md",
      render: (keyword) => keyword.category?.name || "-",
    },
    {
      key: "description",
      label: "Description",
      hideBelow: "md",
      className: "max-w-xs",
      render: (keyword) => (
        <div className="whitespace-normal">{keyword.description || "-"}</div>
      ),
    },
    {
      key: "lang",
      label: "Lang",
      hideBelow: "lg",
      className: "max-w-xs",
      render: (keyword) => (
        <div className="flex flex-wrap gap-1">
          {(keyword.deriveLanguages ?? []).length > 0 ? (
            keyword.deriveLanguages.map((language) => (
              <Badge key={language} variant="outline">
                {LANGUAGE_LABELS[language] ?? language}
              </Badge>
            ))
          ) : keyword.lang ? (
            <Badge variant="outline">
              {LANGUAGE_LABELS[keyword.lang] ?? keyword.lang}
            </Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      ),
    },
    {
      key: "includes",
      label: "Recall Terms",
      hideBelow: "lg",
      render: (keyword) => (
        <div className="flex flex-wrap gap-1 max-w-md">
          {keyword.includes.map((include) => (
            <Badge key={include} variant="outline">
              {include}
            </Badge>
          ))}
        </div>
      ),
    },
  ];

  // 定义操作配置
  const actions: DataTableAction<KeywordWithCategory>[] = [
    {
      type: "edit",
      render: (keyword) => (
        <EditKeywordDialog
          keyword={keyword}
          categories={categories}
          triggerButton={
            <Button size="sm" variant="outline">
              <PencilIcon className="size-3" />
            </Button>
          }
        />
      ),
    },
    {
      type: "delete",
      render: (keyword) => (
        <DeleteKeywordDialog
          keyword={keyword}
          triggerButton={
            <Button size="sm" variant="outline">
              <TrashIcon className="size-3" />
            </Button>
          }
        />
      ),
    },
  ];

  return (
    <DataTable
      data={keywords}
      columns={columns}
      actions={actions}
      emptyMessage="No keywords found. Add your first keyword to get started."
    />
  );
};

export default KeywordsTable;
