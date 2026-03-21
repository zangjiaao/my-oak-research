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
      key: "lang",
      label: "Lang",
      render: (keyword) => <Badge variant="outline">{keyword.lang}</Badge>,
    },
    {
      key: "category",
      label: "Category",
      render: (keyword) => keyword.category?.name || "-",
    },
    {
      key: "includes",
      label: "Recall Terms",
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
    {
      key: "synonyms",
      label: "Scoring Terms",
      render: (keyword) => (
        <div className="flex flex-wrap gap-1 max-w-md">
          {keyword.synonyms.map((synonym) => (
            <Badge key={synonym} variant="secondary">
              {synonym}
            </Badge>
          ))}
          {keyword.enableAiExpand ? (
            <Badge variant="outline">AI Expand On</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "excludes",
      label: "Exclusion Terms",
      render: (keyword) => (
        <div className="flex flex-wrap gap-1 max-w-2xl">
          {keyword.excludes.map((exclude) => (
            <Badge key={exclude} variant="outline">
              {exclude}
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
