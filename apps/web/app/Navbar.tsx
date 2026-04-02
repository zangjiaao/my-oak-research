"use client";

import React from "react";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarMenuItem,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Home,
  Inbox,
  Settings,
  FileText,
  Book,
  User2,
  ChevronUp,
  LogOutIcon,
  ChevronRight,
  NotepadTextDashed,
  PencilRuler,
  Box,
  Heart,
  ScrollText,
  Globe,
  Workflow,
  Tags,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import Link from "next/link";

const menuItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Follow",
    url: "/follow",
    icon: Inbox,
    items: [
      // {
      //   title: "Settings",
      //   url: "/follow/settings/keyword",
      //   icon: Settings,
      // },
      {
        title: "Sources",
        url: "/follow/sources",
        icon: Globe,
      },
      {
        title: "Topics",
        url: "/follow/topics",
        icon: Tags,
      },
      {
        title: "Jobs",
        url: "/follow/jobs",
        icon: Workflow,
      },
      {
        title: "Content",
        url: "/follow/content",
        icon: Inbox,
      },
    ],
  },
  {
    title: "Report",
    url: "/report",
    icon: FileText,
    items: [
      {
        title: "Template",
        url: "/report/template",
        icon: NotepadTextDashed,
      },
      {
        title: "Editor",
        url: "/report/editor",
        icon: PencilRuler,
      },
      {
        title: "Manage",
        url: "/report/manage",
        icon: Box,
      },
    ],
  },
  {
    title: "Library",
    url: "/library",
    icon: Book,
    items: [
      {
        title: "Knowledge",
        url: "/library/knowledge",
        icon: Book,
      },

      {
        title: "Favorites",
        url: "/library/favorites",
        icon: Heart,
      },
    ],
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    items: [
      {
        title: "User",
        url: "/settings/user",
        icon: User2,
      },
      {
        title: "Logging",
        url: "/settings/logging",
        icon: ScrollText,
      },
    ],
  },
];

const userMenuItems = [
  {
    title: "Account",
    url: "#",
    icon: User2,
  },
  {
    title: "Sign out",
    url: "#",
    icon: LogOutIcon,
  },
];

const Navbar = ({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  const pathname = usePathname();
  const isActive = React.useCallback(
    (url: string) => pathname === url || pathname.startsWith(url + "/"),
    [pathname]
  );

  const firstMatchIndex = React.useMemo(() => {
    return menuItems.findIndex(
      (g) => isActive(g.url) || (g.items ?? []).some((it) => isActive(it.url))
    );
  }, [isActive]);

  // 默认展开所有有子项的菜单项
  const [localOpen, setLocalOpen] = React.useState<Record<number, boolean>>(
    () => {
      const initial: Record<number, boolean> = {};
      menuItems.forEach((item, idx) => {
        if (item.items) {
          initial[idx] = true;
        }
      });
      return initial;
    }
  );

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 p-2">
          <h1 className="text-xl font-light">Oak</h1>
          <h1 className="text-xl font-bold">Research</h1>
          <h1 className="font-bold">/ /</h1>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item, idx) =>
                item.items ? (
                  <Collapsible
                    key={item.title}
                    className="group/collapsible"
                    open={idx === firstMatchIndex || localOpen[idx] === true}
                    onOpenChange={(v) =>
                      setLocalOpen((o) => ({ ...o, [idx]: v }))
                    }
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          isActive={
                            isActive(item.url) ||
                            (item.items ?? []).some((it) => isActive(it.url))
                          }
                        >
                          <item.icon />
                          <span>{item.title}</span>
                          <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((sub) => (
                            <SidebarMenuSubItem key={sub.title}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={isActive(sub.url)}
                              >
                                <Link href={sub.url}>
                                  <sub.icon />
                                  <span>{sub.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuItem>
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton>
                  <User2 /> Username
                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-[--radix-popper-anchor-width]"
              >
                {userMenuItems.map((item) => (
                  <DropdownMenuItem key={item.title}>
                    <item.icon />
                    <span>{item.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default Navbar;
