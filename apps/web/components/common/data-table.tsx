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

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render?: (item: T, index: number) => React.ReactNode;
  className?: string;
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

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showIndex && <TableHead>{indexLabel}</TableHead>}
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.label}
            </TableHead>
          ))}
          {hasActions && <TableHead>Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={
                columns.length + (showIndex ? 1 : 0) + (hasActions ? 1 : 0)
              }
              className="text-center text-muted-foreground py-8"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((item, index) => (
            <TableRow key={item.id}>
              {showIndex && <TableCell>{index + 1}</TableCell>}
              {columns.map((column) => (
                <TableCell key={column.key} className={column.className}>
                  {column.render
                    ? column.render(item, index)
                    : (item as any)[column.key]}
                </TableCell>
              ))}
              {hasActions && (
                <TableCell>
                  <div className="flex items-center gap-2">
                    {actions.map((action, actionIndex) => {
                      if (action.render) {
                        return (
                          <div key={actionIndex}>{action.render(item)}</div>
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
  );
}
