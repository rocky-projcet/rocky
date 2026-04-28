import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Archive,
  Bot,
  ChevronDown,
  Home,
  LayoutTemplate,
  ListTodo,
  Search,
  Sparkles,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { SidebarIdentity } from "@/domains/codex/components/sidebar-identity";
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
  return pathname === "/templates" || pathname.startsWith("/templates/");
}

function isSearchRoute(pathname: string): boolean {
  return pathname.startsWith("/search");
}

function isTasksListRoute(pathname: string): boolean {
  return pathname === "/tasks" || pathname.startsWith("/tasks?");
}

function isSkillsRoute(pathname: string): boolean {
  return pathname === "/skills" || pathname.startsWith("/skills/");
}

function isAgentsRoute(pathname: string): boolean {
  return (
    (pathname === "/agents" || pathname.startsWith("/agents/")) &&
    pathname !== "/agents/archived" &&
    !pathname.startsWith("/agents/archived/")
  );
}

function isArchiveRoute(pathname: string): boolean {
  return pathname === "/agents/archived" || pathname === "/skills/archived";
}

export function AppShell() {
  return (
    <SidebarProvider className="h-svh max-h-svh">
      <AppShellInner />
    </SidebarProvider>
  );
}

function AppShellInner() {
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const boundedCanvas = usesBoundedCanvas(location.pathname);
  const compactRoute = isCompactRoute(location.pathname);
  const taskDetailRoute = isTaskDetailRoute(location.pathname);
  const rockyHomeRoute = isRockyHomeRoute(location.pathname);
  const templatesRoute = isTemplatesRoute(location.pathname);
  const searchRoute = isSearchRoute(location.pathname);
  const skillsRoute = isSkillsRoute(location.pathname);
  const agentsRoute = isAgentsRoute(location.pathname);
  const tasksListRoute = isTasksListRoute(location.pathname);
  const archiveRoute = isArchiveRoute(location.pathname);
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
      <Sidebar
        collapsible="icon"
        className="cursor-col-resize [&_a]:cursor-pointer [&_button]:cursor-pointer [&_input]:cursor-text"
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
                    tooltip="작업"
                    isActive={tasksListRoute}
                    render={<NavLink to="/tasks" />}
                  >
                    <ListTodo />
                    <span>작업</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="스킬"
                    isActive={skillsRoute && !location.pathname.startsWith("/skills/archived")}
                    render={<NavLink to="/skills" />}
                  >
                    <Sparkles />
                    <span>스킬</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="내 에이전트"
                    isActive={agentsRoute}
                    render={<NavLink to="/agents" />}
                  >
                    <Bot />
                    <span>내 에이전트</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="스킬 템플릿"
                    isActive={templatesRoute && !location.pathname.startsWith("/templates/archived")}
                    render={<NavLink to="/templates" />}
                  >
                    <LayoutTemplate />
                    <span>스킬 템플릿</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <ArchiveMenuItem
                  archiveOpen={archiveOpen}
                  onToggleArchive={() => setArchiveOpen((open) => !open)}
                  archiveRoute={archiveRoute}
                  pathname={location.pathname}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarIdentity />
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
                  "box-border flex flex-col overflow-hidden",
                  taskDetailRoute
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
    </>
  );
}

function ArchiveMenuItem({
  archiveOpen,
  onToggleArchive,
  archiveRoute,
  pathname,
}: {
  archiveOpen: boolean;
  onToggleArchive: () => void;
  archiveRoute: boolean;
  pathname: string;
}) {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  if (collapsed) {
    return (
      <SidebarMenuItem>
        <Popover>
          <PopoverTrigger
            render={
              <SidebarMenuButton
                tooltip="보관함"
                isActive={archiveRoute}
                type="button"
              >
                <Archive />
                <span>보관함</span>
              </SidebarMenuButton>
            }
          />
          <PopoverContent
            side="right"
            align="start"
            sideOffset={-4}
            className="w-56 gap-1 p-1.5"
          >
            <NavLink
              to="/skills/archived"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition hover:bg-muted",
                  isActive && "bg-muted font-medium",
                )
              }
            >
              <Sparkles className="size-4 text-muted-foreground" />
              <span>스킬 보관함</span>
            </NavLink>
            <NavLink
              to="/agents/archived"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground transition hover:bg-muted",
                  isActive && "bg-muted font-medium",
                )
              }
            >
              <Bot className="size-4 text-muted-foreground" />
              <span>내 에이전트 보관함</span>
            </NavLink>
          </PopoverContent>
        </Popover>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="보관함"
        isActive={archiveRoute}
        type="button"
        aria-controls="archive-subtree"
        aria-expanded={archiveOpen}
        onClick={onToggleArchive}
      >
        <Archive />
        <span className="min-w-0 flex-1 truncate">보관함</span>
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
              isActive={pathname === "/skills/archived"}
              render={<NavLink to="/skills/archived" />}
            >
              <Sparkles />
              <span>스킬 보관함</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              isActive={pathname === "/agents/archived"}
              render={<NavLink to="/agents/archived" />}
            >
              <Bot />
              <span>내 에이전트 보관함</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}
