"use client";

import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import KeywordSettingCard from "./KeywordSetting";
import CategorySettingCard from "./CategorySetting";
import { useFollow } from "@/hooks/useFollow";

const KeywordsPage = () => {
  const { categories } = useFollow();

  return (
    <Tabs defaultValue="keywords" className="space-y-2">
      <TabsList>
        <TabsTrigger value="keywords">Keywords</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
      </TabsList>
      <TabsContent value="keywords">
        <KeywordSettingCard categories={categories} />
      </TabsContent>
      <TabsContent value="categories">
        <CategorySettingCard />
      </TabsContent>
    </Tabs>
  );
};

export default KeywordsPage;
