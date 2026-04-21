import { NavLink, useLocation } from "react-router-dom";
import { Bot, Archive } from "lucide-react";

import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/shared/ui/sidebar";

export function NavAgents() {
  const location = useLocation();
  const active = location.pathname.startsWith("/agents") || location.pathname.startsWith("/runs");

  return (
    <>
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          isActive={active && !location.pathname.startsWith("/agents/archived")}
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
