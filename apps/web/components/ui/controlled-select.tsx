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
}

export const ControlledSelect = ({
  value,
  onValueChange,
  placeholder,
  children,
  nullValue = "",
}: ControlledSelectProps) => {
  return (
    <Select
      value={value || nullValue}
      onValueChange={(val) => onValueChange(val === nullValue ? null : val)}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {nullValue && <SelectItem value={nullValue}>None</SelectItem>}
        {children}
      </SelectContent>
    </Select>
  );
};
