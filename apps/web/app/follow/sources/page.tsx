"use client";

import React from "react";
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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
      <Tabs defaultValue="web-sites" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="max-w-full flex-wrap">
            <TabsTrigger value="web-sites">Stream</TabsTrigger>
            <TabsTrigger value="social-media">Interactive</TabsTrigger>
            <TabsTrigger value="search-engines">Retrieval</TabsTrigger>
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
          <SearchEngineSettingCard />
        </TabsContent>
      </Tabs>
      <Tabs defaultValue="auth" className="space-y-2">
        <TabsList className="max-w-full flex-wrap">
          <TabsTrigger value="auth">Auth</TabsTrigger>
          <TabsTrigger value="proxy">Proxy</TabsTrigger>
        </TabsList>
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
