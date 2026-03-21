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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const InnerLayout = ({ children }: { children: React.ReactNode }) => {
  const { selectedContent } = useFollowContent();
  const [isContentVisible, setIsContentVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (selectedContent) {
      setIsContentVisible(true);
    }
  }, [selectedContent]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const sync = (event?: MediaQueryListEvent) => {
      setIsMobile(event ? event.matches : mediaQuery.matches);
    };
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div className="relative grid h-[calc(100vh-7rem)] grid-cols-1 gap-2 overflow-hidden lg:grid-cols-5">
      <div
        className={`${
          isContentVisible ? "lg:col-span-2" : "lg:col-span-5"
        } flex min-h-0 flex-col gap-2 overflow-hidden transition-all duration-300`}
      >
        <ContentFilters />
        <div className="min-h-0 flex-1">
          <ContentList />
        </div>
      </div>

      <div
        className={`
          hidden lg:flex lg:min-h-0 lg:flex-col lg:gap-2
          ${isContentVisible ? "lg:col-span-3" : "lg:hidden"}
        `}
      >
        <div
          className={`absolute top-1/2 -translate-y-1/2 z-10 hidden lg:block ${
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
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      {isMobile ? (
        <Sheet
          open={Boolean(selectedContent) && isContentVisible}
          onOpenChange={setIsContentVisible}
        >
          <SheetContent side="right" className="w-full max-w-none p-0 sm:max-w-none">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle>内容详情</SheetTitle>
              <SheetDescription>查看记录详情并执行收藏/删除操作。</SheetDescription>
            </SheetHeader>
            <div className="h-[calc(100%-4.5rem)] p-2">{children}</div>
          </SheetContent>
        </Sheet>
      ) : null}
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
