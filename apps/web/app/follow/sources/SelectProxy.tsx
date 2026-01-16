import React from "react";
import { Control, Controller } from "react-hook-form";
import { SelectItem } from "@/components/ui/select";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { Proxy } from "@/app/generated/prisma";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/business";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  proxies: Proxy[];
  error?: string;
  required?: boolean;
  name?: string; // 允许自定义字段名
}

const SelectProxy = ({
  control,
  proxies,
  error,
  required,
  name = "proxyId",
}: Props) => {
  return (
    <div className="grid gap-3">
      <Label htmlFor={name}>Proxy</Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <ControlledSelect
            value={field.value}
            onValueChange={field.onChange}
            placeholder="Select a proxy"
            nullValue={required ? "" : "none"}
          >
            {proxies.map((proxy: Proxy) => (
              <SelectItem key={proxy.id} value={proxy.id}>
                {proxy.name}
              </SelectItem>
            ))}
          </ControlledSelect>
        )}
      />
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
};

export default SelectProxy;
