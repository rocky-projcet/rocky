import { useState } from "react";
import { LogIn, LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  useLogoutCodexAccountMutation,
  useProviderAccountsQuery,
  useStartCodexLoginMutation,
} from "../hooks";
import { ProviderGlyph } from "./provider-glyph";
import { providerAccountLabel, providerLabel } from "../lib/provider-display";
import type { ProviderAccountRecord } from "../types";

function initialFromAccount(label: string | null): string {
  if (!label) {
    return "?";
  }
  const first = label.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

export function AccountPopover() {
  const [open, setOpen] = useState(false);
  const accountsQuery = useProviderAccountsQuery();
  const loginCodexMutation = useStartCodexLoginMutation();
  const logoutCodexMutation = useLogoutCodexAccountMutation();
  const providers =
    accountsQuery.data?.providers.filter((provider) => provider.provider === "codex") ?? [];
  const authenticatedProviders = providers.filter(
    (provider) => provider.status === "authenticated"
  );

  if (providers.length === 0) {
    return null;
  }

  const primary = authenticatedProviders[0] ?? providers[0];
  const primaryAccount = providerAccountLabel(primary.accountInfo) ?? primary.statusText;
  const initial = initialFromAccount(primaryAccount);
  const hasAuthenticatedProvider = authenticatedProviders.length > 0;

  function isProviderBusy(provider: ProviderAccountRecord): boolean {
    if (provider.update.status === "pending") {
      return true;
    }

    return loginCodexMutation.isPending || logoutCodexMutation.isPending;
  }

  function canLogin(provider: ProviderAccountRecord): boolean {
    const supportsPrimaryLogin = provider.loginMethods.some(
      (method) => method.id === provider.primaryLoginMethodId && method.supported
    );

    return (
      !isProviderBusy(provider) &&
      provider.status !== "pending" &&
      provider.status !== "authenticated" &&
      supportsPrimaryLogin
    );
  }

  function canLogout(provider: ProviderAccountRecord): boolean {
    return !isProviderBusy(provider) && provider.status === "authenticated";
  }

  function handleLogin(provider: ProviderAccountRecord) {
    if (provider.provider === "codex") {
      void loginCodexMutation.mutateAsync();
    }
  }

  function handleLogout(provider: ProviderAccountRecord) {
    if (provider.provider === "codex") {
      void logoutCodexMutation.mutateAsync();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={hasAuthenticatedProvider ? "ghost" : "outline"}
            size={hasAuthenticatedProvider ? "icon" : "sm"}
            className={hasAuthenticatedProvider ? "rounded-full" : undefined}
          />
        }
      >
        {hasAuthenticatedProvider ? (
          <Avatar className="size-8" size="sm">
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
        ) : (
          <>
            <LogIn size={14} />
            로그인
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">계정</p>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 서비스 로그인 상태를 관리합니다.
            </p>
          </div>

          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.provider}
                className="flex items-center justify-between rounded-2xl border border-border/70 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderGlyph provider={provider.provider} className="size-5 text-[10px]" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {providerLabel(provider.provider)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {providerAccountLabel(provider.accountInfo) ?? provider.statusText}
                    </p>
                  </div>
                </div>
                <Button
                  variant={provider.status === "authenticated" ? "ghost" : "outline"}
                  size="sm"
                  disabled={
                    provider.status === "authenticated"
                      ? !canLogout(provider)
                      : !canLogin(provider)
                  }
                  aria-label={`${providerLabel(provider.provider)} ${
                    provider.status === "authenticated" ? "로그아웃" : "로그인"
                  }`}
                  onClick={() => {
                    if (provider.status === "authenticated") {
                      handleLogout(provider);
                      return;
                    }

                    handleLogin(provider);
                  }}
                >
                  {provider.status === "authenticated" ? (
                    <LogOut size={14} />
                  ) : (
                    <>
                      <LogIn size={14} />
                      {provider.status === "pending" || isProviderBusy(provider)
                        ? "로그인 중..."
                        : "로그인"}
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
