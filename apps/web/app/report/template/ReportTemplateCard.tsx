import React from "react";
import { Card, CardContent } from "@/components/ui/card";

interface ReportTemplateCardProps {
  name: string;
  description?: string | null;
  markdown?: string | null;
  actions?: React.ReactNode;
}

const ReportTemplateCard = ({
  name,
  description,
  markdown,
  actions,
}: ReportTemplateCardProps) => {
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="h-44 w-full rounded-md border border-dashed border-border bg-muted/30" />
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-bold">{name}</h3>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            {markdown && (
              <p className="text-xs text-muted-foreground/80 line-clamp-3">
                {markdown}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center justify-end gap-2 pt-2 text-xs">
              {actions}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ReportTemplateCard;
