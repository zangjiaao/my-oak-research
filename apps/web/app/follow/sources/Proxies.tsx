"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PencilIcon, TrashIcon } from "lucide-react";
import { Proxy } from "@/app/generated/prisma";
import {
  DataTable,
  DataTableColumn,
  DataTableAction,
} from "@/components/common";
import EditProxySettingDialog from "./ProxySettingDialog";
import ProxyDeleteAlert from "./ProxyDeleteAlert";

interface Props {
  proxies: Proxy[];
}

const Proxies = ({ proxies }: Props) => {
  const [editingProxy, setEditingProxy] = useState<Proxy | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleEdit = (proxy: Proxy) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setEditingProxy(proxy);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => {
      setEditingProxy(undefined);
      closeTimerRef.current = null;
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const columns: DataTableColumn<Proxy>[] = [
    {
      key: "id",
      label: "ID",
      render: (proxy, index) => index + 1,
    },
    {
      key: "name",
      label: "Name",
      render: (proxy) => proxy.name,
    },
    {
      key: "type",
      label: "Type",
      render: (proxy) => proxy.type,
    },
    {
      key: "url",
      label: "URL",
      render: (proxy) => proxy.url,
    },
  ];

  const actions: DataTableAction<Proxy>[] = [
    {
      type: "edit",
      render: (proxy) => (
        <Button size="sm" variant="outline" onClick={() => handleEdit(proxy)}>
          <PencilIcon className="size-3" />
        </Button>
      ),
    },
    {
      type: "delete",
      render: (proxy) => (
        <ProxyDeleteAlert
          proxy={proxy}
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
      <EditProxySettingDialog
        currentProxy={editingProxy}
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            handleCloseDialog();
          } else {
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current);
              closeTimerRef.current = null;
            }
            setDialogOpen(true);
          }
        }}
        triggerButton={<Button className="hidden" />} // Hidden button for trigger
      />
      <DataTable
        data={proxies}
        columns={columns}
        actions={actions}
        emptyMessage="No proxies found. Add your first proxy to get started."
      />
    </>
  );
};

export default Proxies;
