"use client";

import { Category } from "@/app/generated/prisma";
import {
  CategoryUpdateSchema,
  CategoryCreateSchema,
} from "@/app/api/_utils/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { SettingEditDialog } from "@/components/layout";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorMessage } from "@/components/business";
import { useCategoryMutation } from "@/hooks/useCategoryMutation";

const EditCategoryDialog = ({
  category,
  triggerButton,
}: {
  category?: Category;
  triggerButton: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  const mutation = useCategoryMutation({
    categoryId: category?.id,
    onSuccess: () => {
      setOpen(false);
      if (!category) {
        reset();
      }
    },
  });

  const CategorySchema = category ? CategoryUpdateSchema : CategoryCreateSchema;
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<z.infer<typeof CategorySchema>>({
    resolver: zodResolver(CategorySchema),
    defaultValues: {
      name: category?.name,
      description: category?.description,
    },
  });

  const onSubmit = async (data: z.infer<typeof CategorySchema>) => {
    mutation.mutate(data);
  };

  return (
    <SettingEditDialog
      props={{ open, onOpenChange: setOpen }}
      title={category ? "Edit Category" : "Add Category"}
      description={
        category
          ? "Edit the category to your list."
          : "Add a new category to your list."
      }
      triggerButton={triggerButton}
      buttonText={
        mutation.isPending
          ? category
            ? "Updating..."
            : "Adding..."
          : category
            ? "Update"
            : "Add"
      }
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4">
        <div className="grid gap-3">
          <Label htmlFor="category-name">Category Name</Label>
          <Input
            id="category-name"
            placeholder="Category Name"
            required
            {...register("name")}
          />
          <ErrorMessage>{errors.name?.message}</ErrorMessage>
        </div>

        <div className="grid gap-3">
          <Label htmlFor="category-description">Category Description</Label>
          <Textarea
            id="category-description"
            placeholder="Category Description"
            {...register("description")}
          />
          <ErrorMessage>{errors.description?.message}</ErrorMessage>
        </div>
      </div>
    </SettingEditDialog>
  );
};

export default EditCategoryDialog;
