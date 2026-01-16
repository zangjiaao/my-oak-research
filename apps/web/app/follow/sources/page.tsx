"use client";

import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import WebSiteSettingCard from "./WebSiteSettingCard";
import SocialMediaSettingCard from "./SocialMediaSettingCard";
import DarknetSettingCard from "./DarknetSettingCard";
import SearchEngineSettingCard from "./SearchEngineSettingCard";
import ProxySettingCard from "./ProxySettingCard";

const Sources = () => {
  return (
    <div>
      <Tabs defaultValue="web-sites" className="space-y-2">
        <TabsList>
          <TabsTrigger value="web-sites">Web Sites</TabsTrigger>
          <TabsTrigger value="social-media">Social Media</TabsTrigger>
          <TabsTrigger value="darknet">Darknet</TabsTrigger>
          <TabsTrigger value="search-engines">Search Engines</TabsTrigger>
          <TabsTrigger value="proxy">Proxy</TabsTrigger>
        </TabsList>
        <TabsContent value="web-sites">
          <WebSiteSettingCard />
        </TabsContent>
        <TabsContent value="social-media">
          <SocialMediaSettingCard />
        </TabsContent>
        <TabsContent value="darknet">
          <DarknetSettingCard />
        </TabsContent>
        <TabsContent value="search-engines">
          <SearchEngineSettingCard />
        </TabsContent>
        <TabsContent value="proxy">
          <ProxySettingCard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Sources;
