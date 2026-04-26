import { Separator } from "@/shared/ui/separator";
import { SidebarTrigger } from "@/shared/ui/sidebar";
import { HeaderBreadcrumb } from "@/shared/components/header-breadcrumb";
import { AccountPopover } from "@/domains/codex/components/account-popover";
import { useProviderAccountsQuery } from "@/domains/codex/hooks";
import { AppModeToggle } from "@/domains/rocky/components/app-mode-toggle";

export function SiteHeader() {
  const accountQuery = useProviderAccountsQuery();
  const isAuthenticated =
    accountQuery.data?.providers.some((provider) => provider.status === "authenticated") ??
    false;

  return (
    <header className="sticky top-0 z-50 flex h-12 shrink-0 items-center gap-2 border-b bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <SidebarTrigger className="ml-2" />
      <Separator orientation="vertical" className="h-12" />
      <div className="flex w-full items-center justify-between pr-4 lg:pr-6">
        <HeaderBreadcrumb />
        <div className="flex items-center gap-2">
          <AppModeToggle />
          {isAuthenticated ? <AccountPopover /> : null}
        </div>
      </div>
    </header>
  );
}
