"use client";

import React, { useState, useEffect } from "react";
import {
  FollowContentProvider,
  useFollowContent,
} from "@/components/follow-content/context";
import { ContentFilters } from "@/components/follow-content/ContentFilters";
import { ContentList } from "@/components/follow-content/ContentList";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

const InnerLayout = ({ children }: { children: React.ReactNode }) => {
  const { selectedContent } = useFollowContent();
  const [isContentVisible, setIsContentVisible] = useState(true);

  useEffect(() => {
    if (selectedContent) {
      setIsContentVisible(true);
    }
  }, [selectedContent]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 relative">
      <div
        className={`${
          isContentVisible ? "lg:col-span-2" : "lg:col-span-5"
        } flex flex-col gap-2 overflow-hidden transition-all duration-300`}
      >
        <ContentFilters />
        <ContentList />
      </div>

      <div
        className={`
          fixed inset-0 z-50 bg-background transition-transform duration-300 flex flex-col gap-2
          ${isContentVisible ? "translate-x-0" : "translate-x-full pointer-events-none"}
          lg:static lg:bg-transparent lg:transition-none lg:translate-x-0 lg:pointer-events-auto
          ${isContentVisible ? "lg:flex lg:col-span-3" : "lg:hidden"}
        `}
      >
        <div
          className={`absolute top-1/2 -translate-y-1/2 z-10 ${
            isContentVisible ? "left-0 lg:-translate-x-1/2" : "hidden"
          }`}
        >
          <Button
            variant="secondary"
            size="icon"
            className="h-12 w-6 rounded-full shadow-md opacity-100 lg:opacity-0 lg:hover:opacity-100 transition-opacity"
            onClick={() => setIsContentVisible(false)}
            title="Hide content"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
};

const FollowContentLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <FollowContentProvider>
      <InnerLayout>{children}</InnerLayout>
    </FollowContentProvider>
  );
};

export default FollowContentLayout;
