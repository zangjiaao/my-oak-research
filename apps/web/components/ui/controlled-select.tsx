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
  return (
    <Select
      value={value || nullValue}
      onValueChange={(val) => onValueChange(val === nullValue ? null : val)}
    >
      <SelectTrigger className="bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={nullValue}>{nullLabel}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
};
