import {
  Control,
  UseFormRegister,
  FieldErrors,
  UseFormWatch,
} from "react-hook-form";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorMessage } from "@/components/business";
import SelectProxy from "./SelectProxy";
import { Proxy } from "@/app/generated/prisma";
import {
  SourceCreateSchema,
  SearchEngineKindEnum,
  SearchEngineSourceCreateSchema,
} from "@/app/api/_utils/zod";
import { Controller } from "react-hook-form";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface SearchEngineFieldsProps {
  register: UseFormRegister<z.infer<typeof SourceCreateSchema>>;
  control: Control<z.infer<typeof SourceCreateSchema>>;
  errors: FieldErrors<z.infer<typeof SourceCreateSchema>>;
  proxies: Proxy[];
  watch: UseFormWatch<z.infer<typeof SourceCreateSchema>>;
}

export const SearchEngineFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
}: SearchEngineFieldsProps) => {
  const searchEngineKind = watch("search.engine") as
    | z.infer<typeof SearchEngineKindEnum>
    | undefined;
  const searchErrors = errors as FieldErrors<
    z.infer<typeof SearchEngineSourceCreateSchema>
  >;
  return (
    <>
      <div className="grid gap-3">
        <Label htmlFor="search.engine">Engine</Label>
        <Controller
          name="search.engine"
          control={control}
          render={({ field }) => (
            <ControlledSelect
              value={field.value as string}
              onValueChange={field.onChange}
              placeholder="Select an engine"
            >
              {Object.values(SearchEngineKindEnum.enum).map((engine) => (
                <SelectItem key={engine} value={engine}>
                  {engine}
                </SelectItem>
              ))}
            </ControlledSelect>
          )}
        />
        <ErrorMessage>
          {searchErrors.search?.engine?.message?.toString()}
        </ErrorMessage>
      </div>
      {searchEngineKind === "CUSTOM" && (
        <div className="grid gap-3">
          <Label htmlFor="search.customConfig">
            Custom Engine Config (JSON)
          </Label>
          <Textarea
            id="search.customConfig"
            placeholder={'{ "key": "value" }'}
            rows={5}
            {...register("search.customConfig")}
          />
          <ErrorMessage>
            {searchErrors.search?.customConfig?.message?.toString()}
          </ErrorMessage>
        </div>
      )}
      <div className="grid gap-3">
        <Label htmlFor="search.query">Query</Label>
        <Input
          id="search.query"
          placeholder="Query"
          {...register("search.query")}
        />
        <ErrorMessage>
          {searchErrors.search?.query?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.region">Region</Label>
        <Input
          id="search.region"
          placeholder="Region"
          {...register("search.region")}
        />
        <ErrorMessage>
          {searchErrors.search?.region?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.lang">Lang</Label>
        <Input
          id="search.lang"
          placeholder="Lang"
          {...register("search.lang")}
        />
        <ErrorMessage>
          {searchErrors.search?.lang?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.apiEndpoint">API Endpoint</Label>
        <Input
          id="search.apiEndpoint"
          placeholder="API Endpoint"
          {...register("search.apiEndpoint")}
        />
        <ErrorMessage>
          {searchErrors.search?.apiEndpoint?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="search.options">Options (JSON)</Label>
        <Input
          id="search.options"
          placeholder="{}"
          {...register("search.options")}
        />
        <ErrorMessage>
          {searchErrors.search?.options?.message?.toString()}
        </ErrorMessage>
      </div>
      <SelectProxy
        control={control}
        proxies={proxies}
        name="search.proxyId"
        error={searchErrors.proxyId?.message?.toString()}
      />
    </>
  );
};
