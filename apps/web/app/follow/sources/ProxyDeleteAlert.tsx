"use client";

import { Proxy } from "@/app/generated/prisma";
import { DeleteAlert } from "@/components/common";

interface Props {
  proxy: Proxy;
  triggerButton: React.ReactNode;
}

const ProxyDeleteAlert = ({ proxy, triggerButton }: Props) => {
  return (
    <DeleteAlert
      item={proxy}
      itemName="name"
      title="Delete Proxy"
      description={(item) =>
        `Are you sure you want to delete "${item.name}" proxy? This action cannot be undone.`
      }
      queryKeys={[["proxies"]]}
      deleteEndpoint={(id) => `/api/follow/proxy/${id}`}
      triggerButton={triggerButton}
    />
  );
};

export default ProxyDeleteAlert;
