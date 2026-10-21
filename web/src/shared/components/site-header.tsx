import { useLocation } from "react-router-dom";

import { cn } from "@/shared/lib/utils";
import { HeaderBreadcrumb, isNestedRoute } from "./header-breadcrumb";
import { LocaleSwitcher } from "./locale-switcher";

export function SiteHeader({ className }: { className?: string }) {
  const location = useLocation();
  const showBreadcrumb = isNestedRoute(location.pathname);

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-3 border-b bg-background pl-4 pr-4 lg:pr-6",
        className,
      )}
    >
      {showBreadcrumb ? <HeaderBreadcrumb /> : null}
      <div className="ml-auto flex items-center gap-2">
        <LocaleSwitcher />
      </div>
    </header>
  );
}
