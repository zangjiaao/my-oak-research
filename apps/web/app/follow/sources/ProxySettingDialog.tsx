"use client";

import { SettingEditDialog } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Proxy, ProxyType } from "@/app/generated/prisma";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ProxyCreateSchema } from "@/app/api/_utils/zod";
import { ErrorMessage } from "@/components/business";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";

interface Props {
  triggerButton: React.ReactNode;
  currentProxy?: Proxy;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EditProxySettingDialog = ({
  triggerButton,
  currentProxy,
  open: controlledOpen,
  onOpenChange,
}: Props) => {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const handleOpenChange = onOpenChange ?? setUncontrolledOpen;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(ProxyCreateSchema),
    defaultValues: {
      name: currentProxy?.name ?? "",
      type: currentProxy?.type ?? "HTTP",
      url: currentProxy?.url ?? "",
    },
  });

  const handleClose = () => handleOpenChange(false);

  useEffect(() => {
    reset({
      name: currentProxy?.name ?? "",
      type: currentProxy?.type ?? "HTTP",
      url: currentProxy?.url ?? "",
    });
  }, [currentProxy, reset]);
  const onSubmit = async (data: z.infer<typeof ProxyCreateSchema>) => {
    setIsSubmitting(true);
    try {
      const endpoint = currentProxy
        ? `/api/follow/proxy/${currentProxy.id}`
        : "/api/follow/proxy";
      const method = currentProxy ? "PATCH" : "POST";
      const body = JSON.stringify(data);
      const res = await fetch(endpoint, { method, body });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      toast.success(
        currentProxy
          ? "Proxy setting updated successfully"
          : "Proxy setting added successfully"
      );
      handleClose();
      setTimeout(() => {
        router.refresh();
      }, 200);
    } catch (error) {
      console.error(error);
      toast.error(
        currentProxy
          ? "Failed to update proxy setting"
          : "Failed to add proxy setting"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SettingEditDialog
      props={{
        open,
        onOpenChange: handleOpenChange,
      }}
      title={currentProxy ? "Update Proxy Setting" : "Add Proxy Setting"}
      description={
        currentProxy
          ? "Update a proxy setting to your list."
          : "Add a new proxy setting to your list."
      }
      triggerButton={triggerButton}
      buttonText={
        isSubmitting
          ? currentProxy
            ? "Updating..."
            : "Adding..."
          : currentProxy
            ? "Update"
            : "Add"
      }
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="grid gap-4">
        <div className="grid gap-3">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Name" required {...register("name")} />
          <ErrorMessage>{errors.name?.message}</ErrorMessage>
        </div>
        <div className="grid gap-3">
          <Label htmlFor="type">Type</Label>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <ControlledSelect
                value={field.value as string | null}
                onValueChange={(value: string | null) => {
                  field.onChange(value);
                }}
                nullValue=""
              >
                {Object.values(ProxyType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </ControlledSelect>
            )}
          />
          <ErrorMessage>{errors.type?.message}</ErrorMessage>
        </div>
        <div className="grid gap-3">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            placeholder="proxy://user:pass@host:port"
            required
            {...register("url")}
          />
          <ErrorMessage>{errors.url?.message}</ErrorMessage>
        </div>
      </div>
    </SettingEditDialog>
  );
};

export default EditProxySettingDialog;
