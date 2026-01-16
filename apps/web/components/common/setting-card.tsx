"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusIcon } from "lucide-react";

export interface SettingCardAction {
  label: string;
  onClick: () => void;
  variant?:
    | "default"
    | "outline"
    | "destructive"
    | "secondary"
    | "ghost"
    | "link";
  icon?: React.ReactNode;
}

export interface SettingCardBadge {
  label: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  color?: "blue" | "green" | "yellow" | "red" | "gray";
}

export interface SettingCardProps {
  // 基础内容
  title: string;
  description?: string;

  // 统计信息
  count?: number;
  countLabel?: string;

  // 徽章信息
  badges?: SettingCardBadge[];

  // 操作按钮
  actions?: SettingCardAction[];
  primaryAction?: {
    label: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };

  // 筛选组件
  filterComponent?: React.ReactNode;

  // 自定义内容
  children?: React.ReactNode;

  // 样式配置
  className?: string;
  compact?: boolean;
}

export function SettingCard({
  title,
  description,
  count,
  countLabel = "items",
  badges = [],
  actions = [],
  primaryAction,
  filterComponent,
  children,
  className,
  compact = false,
}: SettingCardProps) {
  return (
    <Card className={`setting-card ${className || ""}`}>
      <CardHeader className={compact ? "pb-3" : undefined}>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && (
              <CardDescription className="text-sm">
                {description}
              </CardDescription>
            )}
          </div>

          {/* 计数显示 */}
          {count !== undefined && (
            <div className="text-right">
              <div className="text-2xl font-bold text-primary">{count}</div>
              <div className="text-xs text-muted-foreground">{countLabel}</div>
            </div>
          )}
        </div>

        {/* 徽章显示 */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {badges.map((badge, index) => (
              <Badge key={index} variant={badge.variant || "secondary"}>
                {badge.label}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      {(children || actions.length > 0 || primaryAction || filterComponent) && (
        <CardContent className={compact ? "pt-0" : undefined}>
          {/* 筛选组件 */}
          {filterComponent && <div className="mb-4">{filterComponent}</div>}

          {/* 自定义内容 */}
          {children}

          {/* 操作按钮 */}
          {(actions.length > 0 || primaryAction) && (
            <div className="flex flex-wrap items-center gap-2 pt-4">
              {/* 主要操作按钮 */}
              {primaryAction && (
                <Button
                  onClick={primaryAction.onClick}
                  className="flex items-center gap-2"
                >
                  {primaryAction.icon || <PlusIcon className="size-4" />}
                  {primaryAction.label}
                </Button>
              )}

              {/* 其他操作按钮 */}
              {actions.map((action, index) => (
                <Button
                  key={index}
                  variant={action.variant || "outline"}
                  onClick={action.onClick}
                  className="flex items-center gap-2"
                >
                  {action.icon}
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
