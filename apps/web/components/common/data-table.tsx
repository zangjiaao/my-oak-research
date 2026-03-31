"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render?: (item: T, index: number) => React.ReactNode;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
}

export interface DataTableAction<T> {
  type: "edit" | "delete" | "custom";
  label?: string;
  icon?: React.ReactNode;
  onClick?: (item: T) => void;
  render?: (item: T) => React.ReactNode;
  variant?:
    | "default"
    | "outline"
    | "destructive"
    | "secondary"
    | "ghost"
    | "link";
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  actions?: DataTableAction<T>[];
  emptyMessage?: string;
  showIndex?: boolean;
  indexLabel?: string;
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  actions = [],
  emptyMessage = "No data available",
  showIndex = true,
  indexLabel = "ID",
}: DataTableProps<T>) {
  const hasActions = actions.length > 0;
  const getResponsiveClassName = (column: DataTableColumn<T>) => {
    if (column.hideBelow === "sm") return "hidden sm:table-cell";
    if (column.hideBelow === "md") return "hidden md:table-cell";
    if (column.hideBelow === "lg") return "hidden lg:table-cell";
    return "";
  };

  return (
    <div className="w-full min-w-0">
      <Table className="min-w-full">
        <TableHeader>
          <TableRow>
            {showIndex && <TableHead>{indexLabel}</TableHead>}
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(getResponsiveClassName(column), column.className)}
              >
                {column.label}
              </TableHead>
            ))}
            {hasActions && <TableHead className="min-w-[120px] whitespace-nowrap">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={
                  columns.length + (showIndex ? 1 : 0) + (hasActions ? 1 : 0)
                }
                className="py-8 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((item, index) => (
              <TableRow key={item.id}>
                {showIndex && <TableCell>{index + 1}</TableCell>}
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(getResponsiveClassName(column), column.className)}
                  >
                    {column.render
                      ? column.render(item, index)
                      : (item as any)[column.key]}
                  </TableCell>
                ))}
                {hasActions && (
                  <TableCell className="whitespace-nowrap">
                    <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
                      {actions.map((action, actionIndex) => {
                        if (action.render) {
                          return (
                            <div key={actionIndex} className="shrink-0">
                              {action.render(item)}
                            </div>
                          );
                        }

                        return (
                          <Button
                            key={actionIndex}
                            size="sm"
                            variant={action.variant || "outline"}
                            onClick={() => action.onClick?.(item)}
                          >
                            {action.icon ||
                              (action.type === "edit" ? (
                                <PencilIcon className="size-3" />
                              ) : (
                                <TrashIcon className="size-3" />
                              ))}
                            {action.label}
                          </Button>
                        );
                      })}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
