import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Archive, Bot, ChevronDown, Home, Settings2 } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { useI18n } from "@/shared/lib/i18n-provider";
import { MilestoneHost } from "@/domains/onboarding/milestone-host";
import { DesktopChromeBar } from "./desktop-chrome";
import { SidebarLogo } from "./sidebar-logo";
import { SiteHeader } from "./site-header";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  useSidebar,
} from "@/shared/ui/sidebar";

function isRockyHomeRoute(pathname: string): boolean {
  return pathname === "/";
}

function isAgentsRoute(pathname: string): boolean {
  return (
    (pathname === "/agents" || pathname.startsWith("/agents/")) &&
    pathname !== "/agents/archived" &&
    !pathname.startsWith("/agents/archived/")
  );
}

function isArchiveRoute(pathname: string): boolean {
  return pathname === "/agents/archived";
}

function isSettingsRoute(pathname: string): boolean {
  return pathname === "/settings";
}

export function AppShell() {
  return (
    <SidebarProvider className="h-svh max-h-svh flex-col overflow-hidden">
      <AppShellInner />
      <MilestoneHost />
    </SidebarProvider>
  );
}

function AppShellInner() {
  const { t } = useI18n();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const fromQueryParam = new URLSearchParams(location.search).get("from");
  const fromArchiveContext =
    fromQueryParam === "archive" && /^\/agents\/[^/]+/.test(location.pathname);

  const rockyHomeRoute = isRockyHomeRoute(location.pathname);
  const agentsRoute = isAgentsRoute(location.pathname) && !fromArchiveContext;
  const settingsRoute = isSettingsRoute(location.pathname);
  const archiveRoute = isArchiveRoute(location.pathname) || fromArchiveContext;
  const [archiveOpen, setArchiveOpen] = useState(() => archiveRoute);

  useEffect(() => {
    if (archiveRoute) {
      setArchiveOpen(true);
    }
  }, [archiveRoute]);

  function handleSidebarBackgroundClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'button, a, input, textarea, select, [role="button"], [role="link"], [data-slot="sidebar-menu-button"], [data-slot="sidebar-menu-sub-button"]',
      )
    ) {
      return;
    }
    toggleSidebar();
  }

  return (
    <>
      <DesktopChromeBar />
      <div className="flex min-h-0 w-full flex-1">
        <Sidebar
          collapsible="icon"
          className="cursor-col-resize md:top-9 md:h-[calc(100svh-2.25rem)] [&_a]:cursor-pointer [&_button]:cursor-pointer [&_input]:cursor-text"
          onClick={handleSidebarBackgroundClick}
        >
          <SidebarHeader className="px-3 py-4">
            <SidebarLogo />
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={t("shell.home")}
                      isActive={rockyHomeRoute}
                      render={<NavLink to="/" />}
                    >
                      <Home />
                      <span>{t("shell.home")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={t("shell.agents")}
                      isActive={agentsRoute}
                      render={<NavLink to="/agents" />}
                    >
                      <Bot />
                      <span>{t("shell.agents")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <ArchiveMenuItem
                    archiveOpen={archiveOpen}
                    onToggleArchive={() => setArchiveOpen((open) => !open)}
                    archiveRoute={archiveRoute}
                    pathname={location.pathname}
                    fromArchiveContext={fromArchiveContext}
                  />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={t("shell.settings")}
                      isActive={settingsRoute}
                      render={<NavLink to="/settings" />}
                    >
                      <Settings2 />
                      <span>{t("shell.settings")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <SidebarInset>
          <SiteHeader />
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </div>
    </>
  );
}

function ArchiveMenuItem({
  archiveOpen,
  onToggleArchive,
  archiveRoute,
  pathname,
  fromArchiveContext,
}: {
  archiveOpen: boolean;
  onToggleArchive: () => void;
  archiveRoute: boolean;
  pathname: string;
  fromArchiveContext: boolean;
}) {
  const { t } = useI18n();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  const agentsArchiveActive =
    pathname === "/agents/archived" ||
    (fromArchiveContext && /^\/agents\/[^/]+/.test(pathname));

  if (collapsed) {
    return (
      <SidebarMenuItem>
        <Popover>
          <PopoverTrigger
            render={
              <SidebarMenuButton
                tooltip={t("shell.archive")}
                isActive={archiveRoute}
                type="button"
              >
                <Archive />
                <span>{t("shell.archive")}</span>
              </SidebarMenuButton>
            }
          />
          <PopoverContent
            side="right"
            align="start"
            sideOffset={4}
            className="w-52 gap-0.5 rounded-xl border border-sidebar-border bg-sidebar p-1.5 text-sidebar-foreground shadow-lg ring-1 ring-sidebar-border/40"
          >
            <NavLink
              to="/agents/archived"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/85",
                )
              }
            >
              <Bot className="size-4 shrink-0 text-sidebar-foreground/60" />
              <span>{t("shell.agentsArchive")}</span>
            </NavLink>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={t("shell.archive")}
        isActive={archiveRoute}
        type="button"
        aria-controls="archive-subtree"
        aria-expanded={archiveOpen}
        onClick={onToggleArchive}
      >
        <Archive />
        <span className="min-w-0 flex-1 truncate">{t("shell.archive")}</span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 text-sidebar-foreground/45 transition-transform group-data-[collapsible=icon]:hidden",
            archiveOpen ? "rotate-0" : "-rotate-90",
          )}
        />
      </SidebarMenuButton>
      {archiveOpen ? (
        <SidebarMenuSub id="archive-subtree">
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              isActive={agentsArchiveActive}
              render={<NavLink to="/agents/archived" />}
            >
              <Bot />
              <span>{t("shell.agentsArchive")}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}
