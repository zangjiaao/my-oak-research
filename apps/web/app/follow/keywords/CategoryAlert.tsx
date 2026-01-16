"use client";

import { Category } from "@/app/generated/prisma";
import { DeleteAlert } from "@/components/common";

const DeleteCategoryDialog = ({
  category,
  triggerButton,
}: {
  category: Category;
  triggerButton: React.ReactNode;
}) => {
  return (
    <DeleteAlert
      item={category}
      itemName="name"
      title="Delete Category"
      description={(item) =>
        `Are you sure you want to delete "${item.name}" category? This action cannot be undone.`
      }
      queryKeys={[["categories"], ["keywords"]]}
      deleteEndpoint={(id) => `/api/follow/categories/${id}`}
      triggerButton={triggerButton}
    />
  );
};

export default DeleteCategoryDialog;
