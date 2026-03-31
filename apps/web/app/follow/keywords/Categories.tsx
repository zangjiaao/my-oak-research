"use client";
import { Category } from "@/app/generated/prisma";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import EditCategoryDialog from "./CategoryDialog";
import DeleteCategoryDialog from "./CategoryAlert";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";

const CategoryTable = ({ categories }: { categories: Category[] }) => {
  // 定义表格列配置
  const columns: DataTableColumn<Category>[] = [
    {
      key: "name",
      label: "Name",
      render: (category) => category.name,
    },
    {
      key: "description",
      label: "Description",
      hideBelow: "md",
      render: (category) => category.description || "-",
    },
  ];

  // 定义操作配置
  const actions: DataTableAction<Category>[] = [
    {
      type: "edit",
      render: (category) => (
        <EditCategoryDialog
          category={category}
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
      render: (category) => (
        <DeleteCategoryDialog
          category={category}
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
      data={categories}
      columns={columns}
      actions={actions}
      emptyMessage="No categories found. Add your first category to get started."
    />
  );
};

export default CategoryTable;
