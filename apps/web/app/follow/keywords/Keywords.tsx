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
      key: "category",
      label: "Category",
      render: (keyword) => keyword.category?.name || "-",
    },
    {
      key: "description",
      label: "Description",
      className: "max-w-xs",
      render: (keyword) => (
        <div className="whitespace-normal">{keyword.description || "-"}</div>
      ),
    },
    {
      key: "lang",
      label: "Lang",
      render: (keyword) => <Badge variant="outline">{keyword.lang}</Badge>,
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
