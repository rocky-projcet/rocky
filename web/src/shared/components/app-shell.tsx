import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ChevronDown,
  Home,
  LayoutTemplate,
  ListTodo,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { NavAgents } from "@/domains/agent/components/nav-agents";
import { CodexUsageBars } from "@/domains/codex/components/codex-usage-bars";
import { CodexSettingsMenu } from "@/domains/codex/components/codex-settings-menu";
import { Separator } from "@/shared/ui/separator";
import { SidebarLogo } from "./sidebar-logo";
import { SiteHeader } from "./site-header";
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
  SidebarProvider,
} from "@/shared/ui/sidebar";

function isCompactRoute(pathname: string): boolean {
  return pathname.startsWith("/agents/") && pathname.includes("/sessions/");
}

function isAgentDetailRoute(pathname: string): boolean {
  return /^\/agents\/[^/]+$/.test(pathname);
}

function isTaskDetailRoute(pathname: string): boolean {
  return /^\/tasks\/[^/]+$/.test(pathname);
}

function usesBoundedCanvas(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/agents" ||
    isTaskDetailRoute(pathname) ||
    isAgentDetailRoute(pathname) ||
    isCompactRoute(pathname)
  );
}

function isRockyHomeRoute(pathname: string): boolean {
  return pathname === "/";
}

function isTemplatesRoute(pathname: string): boolean {
  return pathname.startsWith("/templates");
}

function isSearchRoute(pathname: string): boolean {
  return pathname.startsWith("/search");
}

function isTasksRoute(pathname: string): boolean {
  return pathname.startsWith("/tasks");
}

function isAdvancedManagementRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/agents") ||
    pathname.startsWith("/runs") ||
    pathname.startsWith("/rocky/agent")
  );
}

export function AppShell() {
  const location = useLocation();
  const boundedCanvas = usesBoundedCanvas(location.pathname);
  const compactRoute = isCompactRoute(location.pathname);
  const taskDetailRoute = isTaskDetailRoute(location.pathname);
  const rockyHomeRoute = isRockyHomeRoute(location.pathname);
  const templatesRoute = isTemplatesRoute(location.pathname);
  const searchRoute = isSearchRoute(location.pathname);
  const tasksRoute = isTasksRoute(location.pathname);
  const advancedManagementRoute = isAdvancedManagementRoute(location.pathname);
  const [advancedManagementOpen, setAdvancedManagementOpen] = useState(
    () => advancedManagementRoute,
  );

  useEffect(() => {
    if (advancedManagementRoute) {
      setAdvancedManagementOpen(true);
    }
  }, [advancedManagementRoute]);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-4">
          <SidebarLogo />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="검색"
                    isActive={searchRoute}
                    render={<NavLink to="/search" />}
                  >
                    <Search />
                    <span>검색</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="홈"
                    isActive={rockyHomeRoute}
                    render={<NavLink to="/" />}
                  >
                    <Home />
                    <span>홈</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="작업"
                    isActive={tasksRoute}
                    render={<NavLink to="/tasks" />}
                  >
                    <ListTodo />
                    <span>작업</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="템플릿"
                    isActive={templatesRoute}
                    render={<NavLink to="/templates" />}
                  >
                    <LayoutTemplate />
                    <span>템플릿</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="고급 관리"
                    isActive={advancedManagementRoute}
                    type="button"
                    aria-controls="advanced-management-subtree"
                    aria-expanded={advancedManagementOpen}
                    onClick={() => setAdvancedManagementOpen((open) => !open)}
                  >
                    <SlidersHorizontal />
                    <span className="min-w-0 flex-1 truncate">고급 관리</span>
                    <ChevronDown
                      className={cn(
                        "ml-auto size-3.5 text-sidebar-foreground/45 transition-transform group-data-[collapsible=icon]:hidden",
                        advancedManagementOpen ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </SidebarMenuButton>
                  {advancedManagementOpen ? (
                    <SidebarMenuSub id="advanced-management-subtree">
                      <NavAgents />
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <CodexUsageBars />
              <Separator className="w-full my-2" />
              <SidebarMenu>
                <SidebarMenuItem>
                  <CodexSettingsMenu />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <SiteHeader />

        <div
          className={cn(
            "min-h-0 flex-1",
            boundedCanvas
              ? cn(
                "box-border flex h-[calc(100svh-3rem)] max-h-[calc(100svh-3rem)] min-h-0 flex-col overflow-hidden",
                rockyHomeRoute || taskDetailRoute
                  ? "p-0"
                  : compactRoute
                    ? "p-5 md:p-6"
                    : "p-8 md:p-10",
              )
              : "custom-scrollbar overflow-y-auto p-8 md:p-10",
          )}
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
