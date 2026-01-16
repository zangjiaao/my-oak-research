"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { SocialMediaSourceConfig, Source, Proxy } from "@/app/generated/prisma";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import SourceDialog from "./SourceDialog";
import SourceDeleteAlert from "./SourceDeleteAlert";

interface Props {
  sources: (Source & { social: SocialMediaSourceConfig } & {
    proxy?: Proxy | null;
  })[];
  proxies: Proxy[];
}

type SocialMediaSource = Source & {
  social: SocialMediaSourceConfig;
  proxy?: Proxy | null;
};

const SocialMediaSources = ({ sources, proxies }: Props) => {
  const [editingSource, setEditingSource] = useState<
    SocialMediaSource | undefined
  >();

  const handleEdit = (source: SocialMediaSource) => {
    setEditingSource(source);
  };

  const handleCloseDialog = () => {
    setEditingSource(undefined);
  };

  const columns: DataTableColumn<SocialMediaSource>[] = [
    {
      key: "name",
      label: "Name",
      render: (source) => source.name,
    },
    {
      key: "description",
      label: "Description",
      render: (source) => source.description,
    },
    {
      key: "platform",
      label: "Type",
      render: (source) => source.social.platform,
    },
    {
      key: "proxy",
      label: "Proxy",
      render: (source) => source.proxy?.name || "None",
    },
  ];

  const actions: DataTableAction<SocialMediaSource>[] = [
    {
      type: "edit",
      render: (source) => (
        <Button size="sm" variant="outline" onClick={() => handleEdit(source)}>
          <PencilIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "delete",
      render: (source) => (
        <SourceDeleteAlert
          source={source}
          queryKeyType="SOCIAL_MEDIA"
          triggerButton={
            <Button size="sm" variant="outline">
              <TrashIcon className="size-3" />
            </Button>
          }
        />
      ),
    },
  ];

  return (
    <>
      <SourceDialog
        sourceType="SOCIAL_MEDIA"
        source={editingSource}
        proxies={proxies}
        open={!!editingSource}
        onOpenChange={(open) => !open && handleCloseDialog()}
      />
      <DataTable
        data={sources as SocialMediaSource[]}
        columns={columns}
        actions={actions}
        emptyMessage="No social media sources found. Add your first social media source to get started."
      />
    </>
  );
};

export default SocialMediaSources;
