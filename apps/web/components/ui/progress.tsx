import * as React from "react";

import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 当前进度值，默认与 `valueMax` 一致时为 100%
   */
  value?: number;
  /**
   * 最大值，默认为 100
   */
  valueMax?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, valueMax = 100, ...props }, ref) => {
    const normalizedValue = Math.min(valueMax, Math.max(0, value ?? 0));
    const percent =
      valueMax === 0 ? 0 : Math.round((normalizedValue / valueMax) * 100);

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-muted",
          className
        )}
        {...props}
      >
        <div
          className="absolute inset-0 rounded-full bg-primary transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
