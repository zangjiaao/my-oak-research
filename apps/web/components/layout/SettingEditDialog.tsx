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

      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {children}

          <DialogFooter>
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
