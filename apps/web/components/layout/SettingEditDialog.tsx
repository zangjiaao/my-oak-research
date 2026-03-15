"use client";

import React from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  description: string;
  triggerButton: React.ReactNode;
  children: React.ReactNode;
  buttonText: string;
  props?: React.ComponentProps<typeof Dialog>;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}

export const SettingEditDialog = ({
  title,
  description,
  triggerButton,
  children,
  buttonText,
  props = {},
  onSubmit,
}: Props) => {
  return (
    <Dialog {...props}>
      <DialogTrigger asChild>{triggerButton}</DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex max-h-[90vh] flex-col">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

          <DialogFooter className="border-t px-6 py-4">
            <Button type="submit">{buttonText}</Button>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
