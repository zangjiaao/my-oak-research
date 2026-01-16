"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Search } from "lucide-react";
import { SettingCard } from "@/components/common";
import EditProxySettingDialog from "./ProxySettingDialog";
import Proxies from "./Proxies";
import { useFollow } from "@/hooks/useFollow";

const ProxySettingCard = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const { proxies = [] } = useFollow();

  // 筛选数据
  const filteredProxies = useMemo(
    () =>
      proxies.filter(
        (proxy) =>
          proxy.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          proxy.url?.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [proxies, searchQuery]
  );

  // 筛选组件
  const filterComponent = (
    <div className="flex items-center gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search proxy settings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <EditProxySettingDialog
        triggerButton={
          <Button>
            <PlusIcon className="size-4" />
            Add Proxy Setting
          </Button>
        }
      />
    </div>
  );

  return (
    <SettingCard
      title="Manage Proxy Settings"
      description="You can manage proxy settings here."
      count={filteredProxies.length}
      countLabel="proxies"
      filterComponent={filterComponent}
    >
      <Proxies proxies={filteredProxies} />
    </SettingCard>
  );
};

export default ProxySettingCard;
