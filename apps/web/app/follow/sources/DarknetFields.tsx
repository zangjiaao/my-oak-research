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
  CrawlerEngineEnum,
  DarknetSourceCreateSchema,
} from "@/app/api/_utils/zod";
import { Controller } from "react-hook-form";
import { ControlledSelect } from "@/components/ui/controlled-select";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface DarknetFieldsProps {
  register: UseFormRegister<z.infer<typeof SourceCreateSchema>>;
  control: Control<z.infer<typeof SourceCreateSchema>>;
  errors: FieldErrors<z.infer<typeof SourceCreateSchema>>;
  proxies: Proxy[];
  watch: UseFormWatch<z.infer<typeof SourceCreateSchema>>;
}

export const DarknetFields = ({
  register,
  control,
  errors,
  proxies,
  watch,
}: DarknetFieldsProps) => {
  const darknetErrors = errors as FieldErrors<
    z.infer<typeof DarknetSourceCreateSchema>
  >;
  const crawlerEngine = watch("darknet.crawlerEngine") as
    | z.infer<typeof CrawlerEngineEnum>
    | undefined;
  return (
    <>
      <div className="grid gap-3">
        <Label htmlFor="darknet.url">Domain(s)</Label>
        <Textarea
          id="darknet.url"
          placeholder={"https://xxxxxxxxxxxxxxxx.onion\nhttps://yyyyyyyyyyyyyyyy.onion"}
          rows={3}
          {...register("darknet.url")}
        />
        <ErrorMessage>
          {darknetErrors.darknet?.url?.message?.toString()}
        </ErrorMessage>
      </div>
      <div className="grid gap-3">
        <Label htmlFor="darknet.crawlerEngine">Crawler Engine</Label>
        <Controller
          name="darknet.crawlerEngine"
          control={control}
          render={({ field }) => (
            <ControlledSelect
              value={field.value as string}
              onValueChange={field.onChange}
              placeholder="Select a crawler engine"
            >
              {Object.values(CrawlerEngineEnum.enum).map((engine) => (
                <SelectItem key={engine} value={engine}>
                  {engine}
                </SelectItem>
              ))}
            </ControlledSelect>
          )}
        />
        <ErrorMessage>
          {darknetErrors.darknet?.crawlerEngine?.message?.toString()}
        </ErrorMessage>
      </div>
      {crawlerEngine === "CUSTOM" && (
        <div className="grid gap-3">
          <Label htmlFor="darknet.crawlerConfig">
            Custom Crawler Config (JSON)
          </Label>
          <Textarea
            id="darknet.crawlerConfig"
            placeholder={'{ "key": "value" }'}
            rows={5}
            {...register("darknet.crawlerConfig")}
          />
          <ErrorMessage>
            {darknetErrors.darknet?.crawlerConfig?.message?.toString()}
          </ErrorMessage>
        </div>
      )}
      <SelectProxy
        control={control}
        proxies={proxies}
        name="darknet.proxyId"
        error={darknetErrors.darknet?.proxyId?.message?.toString()}
        required={true}
      />
    </>
  );
};
