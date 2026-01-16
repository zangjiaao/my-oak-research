"use client";
import React from "react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { StarIcon, MoonIcon, XIcon } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { useFavorites, useToggleFavorite } from "@/hooks/useFavorites";

const Headbar = () => {
  const pathname = usePathname();
  const { data: favoritesData, isLoading } = useFavorites({ limit: 50 });
  const toggleFavorite = useToggleFavorite();

  const bookmarks = favoritesData?.items ?? [];

  const generateBreadcrumbs = () => {
    const segments = pathname.split("/").filter(Boolean);
    const breadcrumbs = [{ label: "Home", href: "/" }];

    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      const label = segment.charAt(0).toUpperCase() + segment.slice(1);
      breadcrumbs.push({
        label,
        href: currentPath,
      });
    }

    return breadcrumbs;
  };

  const breadcrumbItems = generateBreadcrumbs();

  return (
    <header className="flex h-16 shrink-0 items-center border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbItems.map(
              (item: { label: string; href: string }, index: number) => (
                <React.Fragment key={item.label}>
                  <BreadcrumbItem>
                    {index < breadcrumbItems.length - 1 ? (
                      <BreadcrumbLink asChild>
                        <Link href={item.href}>{item.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{item.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbItems.length - 1 && (
                    <BreadcrumbSeparator />
                  )}
                </React.Fragment>
              )
            )}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost">
                <StarIcon />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>收藏内容</DialogTitle>
                <DialogDescription>快速回到已保存的情报摘要</DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[55vh]">
                {isLoading ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                    <p>加载中...</p>
                  </div>
                ) : bookmarks.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                    <p>暂无收藏内容</p>
                    <p>在内容列表中点击心形即可添加收藏</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {bookmarks.map((bookmark) => (
                      <Card
                        key={bookmark.id}
                        className="border border-border/70 bg-card/50"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold leading-snug">
                                {bookmark.title}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                                {bookmark.summary}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="取消收藏"
                              onClick={() => {
                                const currentlyBookmarked = true;
                                toggleFavorite.mutate({
                                  contentId: bookmark.id,
                                  isFavorite: !currentlyBookmarked,
                                });
                              }}
                            >
                              <XIcon className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{bookmark.platform}</span>
                            <span>
                              {new Date(bookmark.time).toLocaleString()}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </DialogContent>
          </Dialog>
          <Button variant="ghost">
            <MoonIcon />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Headbar;
