import { NavLink } from "react-router-dom";

import { resolvePublicAssetPath } from "@/shared/lib/public-asset";
import { cn } from "@/shared/lib/utils";
import { useSidebar } from "@/shared/ui/sidebar";

export function SidebarLogo() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <NavLink to="/" className="block">
      <div className={cn("h-6 overflow-hidden transition-all", collapsed ? "w-6" : "w-40 px-2")}>
        <img
          src={resolvePublicAssetPath("Rocky_logo_inline.svg")}
          alt="Rocky"
          className="h-full w-auto max-w-none"
        />
      </div>
    </NavLink>
  );
}
