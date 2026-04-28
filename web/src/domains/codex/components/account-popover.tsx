import { useState } from "react";
import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  useLogoutClaudeAccountMutation,
  useLogoutCodexAccountMutation,
  useProviderAccountsQuery,
} from "../hooks";
import { ProviderGlyph } from "./provider-glyph";
import { providerAccountLabel, providerLabel } from "../lib/provider-display";

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
  const logoutCodexMutation = useLogoutCodexAccountMutation();
  const logoutClaudeMutation = useLogoutClaudeAccountMutation();
  const providers =
    accountsQuery.data?.providers.filter((provider) => provider.status === "authenticated") ?? [];

  if (providers.length === 0) {
    return null;
  }

  const primary = providers[0];
  const primaryAccount = providerAccountLabel(primary.accountInfo) ?? primary.statusText;
  const initial = initialFromAccount(primaryAccount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="rounded-full" />}>
        <Avatar className="size-8" size="sm">
          <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
            {initial}
          </AvatarFallback>
        </Avatar>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">로그인된 계정</p>
            <p className="mt-1 text-xs text-muted-foreground">
              현재 사용 중인 AI 서비스 계정입니다.
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
                  variant="ghost"
                  size="sm"
                  disabled={
                    provider.provider === "codex"
                      ? logoutCodexMutation.isPending
                      : logoutClaudeMutation.isPending
                  }
                  onClick={() => {
                    if (provider.provider === "codex") {
                      void logoutCodexMutation.mutateAsync();
                      return;
                    }

                    void logoutClaudeMutation.mutateAsync();
                  }}
                >
                  <LogOut size={14} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
