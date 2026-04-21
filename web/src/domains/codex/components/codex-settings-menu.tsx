import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";

import { useProviderAccountsQuery } from "../hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { SidebarMenuButton, useSidebar } from "@/shared/ui/sidebar";

export function CodexSettingsMenu() {
  const navigate = useNavigate();
  const { isMobile, state } = useSidebar();
  const accountsQuery = useProviderAccountsQuery();
  const providers = accountsQuery.data?.providers ?? [];
  const neonStatus =
    providers.some((provider) => provider.status === "pending")
      ? "pending"
      : providers.some((provider) => provider.status === "authenticated")
        ? "active"
        : providers.some((provider) => provider.status === "error")
          ? "error"
          : "off";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
        <SidebarMenuButton className="h-auto py-2" aria-label="설정 열기">
          <Sparkles size={16} className="text-amber-500" />
          <span className="flex-1 truncate text-xs group-data-[collapsible=icon]:hidden">
            설정
          </span>
          <span
            className="neon-dot shrink-0 group-data-[collapsible=icon]:hidden"
            data-status={neonStatus}
          />
        </SidebarMenuButton>
        }
        onClick={() => navigate("/settings")}
      />
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
      >
        설정
      </TooltipContent>
    </Tooltip>
  );
}
