"use client";

import React from "react";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import WebSiteSettingCard from "./WebSiteSettingCard";
import SocialMediaSettingCard from "./SocialMediaSettingCard";
import SearchEngineSettingCard from "./SearchEngineSettingCard";
import ProxySettingCard from "./ProxySettingCard";
import BatchCreateSourcesDialog from "./BatchCreateSourcesDialog";
import { useFollow } from "@/hooks/useFollow";
import CredentialSettingCard from "./CredentialSettingCard";

const Sources = () => {
  const { proxies } = useFollow();
  const [activeTab, setActiveTab] = useState("web-sites");
  const showSourceBatchCreate =
    activeTab === "web-sites" ||
    activeTab === "social-media" ||
    activeTab === "search-engines";

  return (
    <div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex max-w-full flex-wrap items-center gap-4">
            <TabsList>
              <TabsTrigger value="web-sites">Stream</TabsTrigger>
              <TabsTrigger value="social-media">Interactive</TabsTrigger>
              <TabsTrigger value="search-engines">Retrieval</TabsTrigger>
            </TabsList>
            <TabsList>
              <TabsTrigger value="auth">Auth</TabsTrigger>
              <TabsTrigger value="proxy">Proxy</TabsTrigger>
            </TabsList>
          </div>
          {showSourceBatchCreate ? <BatchCreateSourcesDialog proxies={proxies} /> : null}
        </div>
        <TabsContent value="web-sites">
          <WebSiteSettingCard />
        </TabsContent>
        <TabsContent value="social-media">
          <SocialMediaSettingCard />
        </TabsContent>
        <TabsContent value="search-engines">
          <SearchEngineSettingCard />
        </TabsContent>
        <TabsContent value="auth">
          <CredentialSettingCard />
        </TabsContent>
        <TabsContent value="proxy">
          <ProxySettingCard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Sources;
