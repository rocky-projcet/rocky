import { useState } from "react";
import { Link } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";

import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { Separator } from "@/shared/ui/separator";
import {
  useLogoutClaudeAccountMutation,
  useLogoutCodexAccountMutation,
  useProviderAccountsQuery,
} from "../hooks";
import { ProviderGlyph } from "./provider-glyph";
import { providerAccountLabel, providerLabel } from "../lib/provider-display";

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

  const initials = providers.map((provider) => provider.provider[0].toUpperCase()).join("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" />}
      >
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium text-foreground">연결된 AI 서비스</p>
            <p className="mt-1 text-xs text-muted-foreground">
              현재 로그인된 AI 서비스 계정 상태입니다.
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

        <Separator />
        <div className="px-2 py-2">
          <Link
            to="/settings"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground no-underline"
            onClick={() => setOpen(false)}
          >
            <Settings size={16} />
            설정
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
