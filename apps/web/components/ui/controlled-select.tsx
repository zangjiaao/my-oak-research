import { Children } from "react";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface ControlledSelectProps {
  value: string | null | undefined;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  children: React.ReactNode;
  nullValue?: string;
  nullLabel?: string;
}

export const ControlledSelect = ({
  value,
  onValueChange,
  placeholder,
  children,
  nullValue,
  nullLabel,
}: ControlledSelectProps) => {
  const resolvedNullValue = nullValue ?? "";
  const resolvedNullLabel = nullLabel ?? "None";
  const hasExplicitNullOptionConfig = nullValue !== undefined || nullLabel !== undefined;
  const childCount = Children.count(children);
  const showNullOption = hasExplicitNullOptionConfig || childCount === 0;
  const effectiveNullValue =
    resolvedNullValue.trim().length > 0 ? resolvedNullValue : "__NULL__";

  return (
    <Select
      value={value || effectiveNullValue}
      onValueChange={(val) => onValueChange(val === effectiveNullValue ? null : val)}
    >
      <SelectTrigger className="bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {showNullOption ? (
          <SelectItem value={effectiveNullValue}>{resolvedNullLabel}</SelectItem>
        ) : null}
        {children}
      </SelectContent>
    </Select>
  );
};
