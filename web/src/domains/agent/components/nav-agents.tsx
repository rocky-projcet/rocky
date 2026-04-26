import { NavLink, useLocation } from "react-router-dom";
import { Bot, Archive, Sparkles } from "lucide-react";

import { useAppMode } from "@/shared/lib/app-mode";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/shared/ui/sidebar";

export function NavAgents() {
  const location = useLocation();
  const { mode } = useAppMode();
  const agentsActive =
    location.pathname.startsWith("/agents") || location.pathname.startsWith("/runs");

  return (
    <>
      {mode === "debug" ? (
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            isActive={location.pathname.startsWith("/rocky/agent")}
            render={<NavLink to="/rocky/agent" />}
          >
            <Sparkles />
            <span>Rocky 관리</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ) : null}
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          isActive={agentsActive && !location.pathname.startsWith("/agents/archived")}
          render={<NavLink to="/agents" />}
        >
          <Bot />
          <span>에이전트</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          isActive={location.pathname.startsWith("/agents/archived")}
          render={<NavLink to="/agents/archived" />}
        >
          <Archive />
          <span>보관함</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </>
  );
}
