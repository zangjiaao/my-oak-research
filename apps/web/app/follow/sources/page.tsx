"use client";

import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import WebSiteSettingCard from "./WebSiteSettingCard";
import SocialMediaSettingCard from "./SocialMediaSettingCard";
import DarknetSettingCard from "./DarknetSettingCard";
import SearchEngineSettingCard from "./SearchEngineSettingCard";
import ProxySettingCard from "./ProxySettingCard";
import BatchCreateSourcesDialog from "./BatchCreateSourcesDialog";
import { useFollow } from "@/hooks/useFollow";

const Sources = () => {
  const { proxies } = useFollow();

  return (
    <div>
      <Tabs defaultValue="web-sites" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="max-w-full flex-wrap">
            <TabsTrigger value="web-sites">Stream</TabsTrigger>
            <TabsTrigger value="social-media">Interactive</TabsTrigger>
            <TabsTrigger value="search-engines">Retrieval</TabsTrigger>
            <TabsTrigger value="proxy">Proxy</TabsTrigger>
          </TabsList>
          <BatchCreateSourcesDialog proxies={proxies} />
        </div>
        <TabsContent value="web-sites">
          <WebSiteSettingCard />
        </TabsContent>
        <TabsContent value="social-media">
          <SocialMediaSettingCard />
        </TabsContent>
        <TabsContent value="search-engines">
          <div className="space-y-3">
            <SearchEngineSettingCard />
            <DarknetSettingCard />
          </div>
        </TabsContent>
        <TabsContent value="proxy">
          <ProxySettingCard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Sources;
