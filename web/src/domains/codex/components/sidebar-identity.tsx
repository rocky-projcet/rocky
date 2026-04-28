import { useProviderAccountsQuery } from "../hooks";
import { ProviderGlyph } from "./provider-glyph";
import { providerAccountLabel } from "../lib/provider-display";

export function SidebarIdentity() {
  const accountsQuery = useProviderAccountsQuery();
  const primary =
    accountsQuery.data?.providers.find((provider) => provider.status === "authenticated") ?? null;

  if (!primary) {
    return null;
  }

  const accountLabel = providerAccountLabel(primary.accountInfo) ?? primary.statusText;

  return (
    <div
      className="flex items-center gap-2 rounded-2xl px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      title={accountLabel}
    >
      <ProviderGlyph
        provider={primary.provider}
        className="size-6 shrink-0 text-[10px]"
      />
      <span className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
        {accountLabel}
      </span>
    </div>
  );
}
