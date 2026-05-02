import { type ReactNode } from "react";
import { LogIn, Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  useProviderAccountsQuery,
  useStartCodexLoginMutation,
} from "../hooks";
import { ProviderGlyph } from "./provider-glyph";
import { providerAccentClasses, providerLabel } from "../lib/provider-display";
import type { ProviderAccountRecord, ProviderKind } from "../types";
import { cn } from "@/shared/lib/utils";

const GATED_PROVIDERS: ReadonlyArray<ProviderKind> = ["codex"];

export function AuthGate({ children }: { children: ReactNode }) {
  const accountsQuery = useProviderAccountsQuery();

  if (accountsQuery.isLoading) {
    return (
      <div className="flex h-svh w-full items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const providers = (accountsQuery.data?.providers ?? []).filter((provider) =>
    GATED_PROVIDERS.includes(provider.provider),
  );
  const hasAuthenticated = providers.some(
    (provider) => provider.status === "authenticated",
  );

  if (hasAuthenticated) {
    return <>{children}</>;
  }

  return <FullScreenLogin providers={providers} />;
}

function FullScreenLogin({ providers }: { providers: ProviderAccountRecord[] }) {
  const ordered = GATED_PROVIDERS.map((kind) =>
    providers.find((provider) => provider.provider === kind),
  ).filter((provider): provider is ProviderAccountRecord => Boolean(provider));

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground">시작하려면 로그인하세요</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Codex 계정으로 로그인하면 Rocky를 사용할 수 있어요.
          </p>
        </div>

        <div className="mt-6 space-y-2">
          {ordered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              사용 가능한 로그인 제공자를 불러오지 못했어요. 백엔드가 실행 중인지 확인해 주세요.
            </div>
          ) : (
            ordered.map((provider) => (
              <ProviderLoginRow key={provider.provider} provider={provider} />
            ))
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          로그인 버튼을 누르면 외부 브라우저 또는 CLI 인증 창이 열립니다.
        </p>
      </div>
    </div>
  );
}

function ProviderLoginRow({ provider }: { provider: ProviderAccountRecord }) {
  const codexLogin = useStartCodexLoginMutation();
  const isCodex = provider.provider === "codex";
  const isPending =
    provider.status === "pending" || (isCodex && codexLogin.isPending);

  const supportsPrimary = provider.loginMethods.some(
    (method) => method.id === provider.primaryLoginMethodId && method.supported,
  );
  const cliInstalled = provider.diagnostics.installStatus === "installed";
  const disabled = isPending || !supportsPrimary || !cliInstalled;

  function handleLogin() {
    if (isCodex) {
      void codexLogin.mutateAsync();
    }
  }

  const subtitle = !cliInstalled
    ? `${provider.providerLabel} CLI가 설치되어 있지 않습니다.`
    : isPending
      ? "로그인 진행 중…"
      : provider.statusText;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
        providerAccentClasses(provider.provider),
      )}
    >
      <ProviderGlyph provider={provider.provider} className="size-9 text-base" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {providerLabel(provider.provider)}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <Button
        variant="default"
        size="sm"
        disabled={disabled}
        onClick={handleLogin}
        aria-label={`${providerLabel(provider.provider)} 로그인`}
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <LogIn className="size-3.5" />
        )}
        로그인
      </Button>
    </div>
  );
}
