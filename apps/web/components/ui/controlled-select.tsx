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
  nullValue = "",
  nullLabel = "None",
}: ControlledSelectProps) => {
  const effectiveNullValue = nullValue.trim().length > 0 ? nullValue : "__NULL__";

  return (
    <Select
      value={value || effectiveNullValue}
      onValueChange={(val) => onValueChange(val === effectiveNullValue ? null : val)}
    >
      <SelectTrigger className="bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={effectiveNullValue}>{nullLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
};
