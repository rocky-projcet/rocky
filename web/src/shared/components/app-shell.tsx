import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Archive,
  Bot,
  ChevronDown,
  Home,
  LayoutTemplate,
  ListTodo,
  Plug,
  Search,
  Sparkles,
  Star,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { useI18n } from "@/shared/lib/i18n-provider";
import { AuthGate } from "@/domains/codex/components/auth-gate";
import { MilestoneHost } from "@/domains/onboarding/milestone-host";
import { ProductTourOrchestrator } from "@/domains/onboarding/product-tour-orchestrator";
import { SidebarIdentity } from "@/domains/codex/components/sidebar-identity";
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
  return isTaskDetailRoute(pathname) || isCompactRoute(pathname);
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

function isFavoritesRoute(pathname: string): boolean {
  return pathname.startsWith("/favorites");
}

function isIntegrationsRoute(pathname: string): boolean {
  return pathname.startsWith("/integrations");
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
    <AuthGate>
      <SidebarProvider className="h-svh max-h-svh flex-col overflow-hidden">
        <AppShellInner />
        <ProductTourOrchestrator />
        <MilestoneHost />
      </SidebarProvider>
    </AuthGate>
  );
}

function AppShellInner() {
  const { t } = useI18n();
  const location = useLocation();
  const { toggleSidebar } = useSidebar();
  const fromQueryParam = new URLSearchParams(location.search).get("from");
  const fromArchiveContext =
    fromQueryParam === "archive" &&
    (/^\/agents\/[^/]+/.test(location.pathname) ||
      /^\/skills\/[^/]+/.test(location.pathname));

  const boundedCanvas = usesBoundedCanvas(location.pathname);
  const compactRoute = isCompactRoute(location.pathname);
  const taskDetailRoute = isTaskDetailRoute(location.pathname);
  const rockyHomeRoute = isRockyHomeRoute(location.pathname);
  const templatesRoute = isTemplatesRoute(location.pathname);
  const searchRoute = isSearchRoute(location.pathname);
  const favoritesRoute = isFavoritesRoute(location.pathname);
  const integrationsRoute = isIntegrationsRoute(location.pathname);
  const skillsRoute = isSkillsRoute(location.pathname) && !fromArchiveContext;
  const agentsRoute = isAgentsRoute(location.pathname) && !fromArchiveContext;
  const tasksListRoute = isTasksListRoute(location.pathname);
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
                      tooltip={t("shell.search")}
                      isActive={searchRoute}
                      render={<NavLink to="/search" />}
                    >
                      <Search />
                      <span>{t("shell.search")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={t("shell.integrations")}
                      isActive={integrationsRoute}
                      render={<NavLink to="/integrations" />}
                    >
                      <Plug />
                      <span>{t("shell.integrations")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip={t("shell.favorites")}
                      isActive={favoritesRoute}
                      render={<NavLink to="/favorites" />}
                    >
                      <Star />
                      <span>{t("shell.favorites")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem data-tour="nav-tasks">
                    <SidebarMenuButton
                      tooltip={t("shell.tasks")}
                      isActive={tasksListRoute}
                      render={<NavLink to="/tasks" />}
                    >
                      <ListTodo />
                      <span>{t("shell.tasks")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem data-tour="nav-skills">
                    <SidebarMenuButton
                      tooltip={t("shell.skills")}
                      isActive={skillsRoute && !location.pathname.startsWith("/skills/archived")}
                      render={<NavLink to="/skills" />}
                    >
                      <Sparkles />
                      <span>{t("shell.skills")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem data-tour="nav-agents">
                    <SidebarMenuButton
                      tooltip={t("shell.agents")}
                      isActive={agentsRoute}
                      render={<NavLink to="/agents" />}
                    >
                      <Bot />
                      <span>{t("shell.agents")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem data-tour="nav-skill-templates">
                    <SidebarMenuButton
                      tooltip={t("shell.skillTemplates")}
                      isActive={templatesRoute && !location.pathname.startsWith("/templates/archived")}
                      render={<NavLink to="/templates" />}
                    >
                      <LayoutTemplate />
                      <span>{t("shell.skillTemplates")}</span>
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
                : "custom-scrollbar overflow-y-auto",
            )}
          >
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
  const skillsArchiveActive =
    pathname === "/skills/archived" ||
    (fromArchiveContext && /^\/skills\/[^/]+/.test(pathname));
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
              to="/skills/archived"
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
              <Sparkles className="size-4 shrink-0 text-sidebar-foreground/60" />
              <span>{t("shell.skillsArchive")}</span>
            </NavLink>
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
              isActive={skillsArchiveActive}
              render={<NavLink to="/skills/archived" />}
            >
              <Sparkles />
              <span>{t("shell.skillsArchive")}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
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
