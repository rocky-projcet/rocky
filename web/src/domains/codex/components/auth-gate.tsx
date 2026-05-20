import { type ReactNode } from "react";
import { LogIn, Loader2, RefreshCw, RotateCw, TerminalSquare } from "lucide-react";

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
const BOOT_VIDEO_PATH = "/rocky-start-screen.mp4";

export function AuthGate({ children }: { children: ReactNode }) {
  const accountsQuery = useProviderAccountsQuery();

  if (accountsQuery.isLoading) {
    return (
      <div className="flex h-svh w-full items-center justify-center bg-background px-6 py-8 sm:px-10">
        <video
          className="max-h-[72vh] w-full max-w-3xl object-contain"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        >
          <source src={BOOT_VIDEO_PATH} type="video/mp4" />
        </video>
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

  const missingInstall = providers.find(
    (provider) => provider.diagnostics.installStatus !== "installed",
  );
  if (missingInstall) {
    return (
      <FullScreenInstallRequired
        provider={missingInstall}
        onRefresh={() => {
          void accountsQuery.refetch();
        }}
        isRefreshing={accountsQuery.isFetching}
      />
    );
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

function FullScreenInstallRequired({
  provider,
  onRefresh,
  isRefreshing,
}: {
  provider: ProviderAccountRecord;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const label = providerLabel(provider.provider);
  const detectedCommand = provider.diagnostics.command;
  const preferredMethod = provider.diagnostics.installMethod;
  const npmCommand = "npm install -g @openai/codex";
  const brewCommand = "brew install codex";

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl border border-border/70 bg-muted text-muted-foreground">
            <TerminalSquare className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground">
              {label} 설치가 필요해요
            </h1>
            <p className="text-xs text-muted-foreground">
              Rocky를 사용하려면 먼저 {label}를 설치해 주세요.
            </p>
          </div>
        </div>

        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          아래 명령어 중 환경에 맞는 것을 터미널에서 실행한 뒤,{" "}
          <span className="font-medium text-foreground">다시 확인</span>{" "}
          버튼을 눌러 주세요.
        </p>

        <div className="mt-4 space-y-3">
          <InstallCommandBlock
            label="npm (권장)"
            command={npmCommand}
            highlight={preferredMethod === "npm-global"}
          />
          <InstallCommandBlock
            label="Homebrew"
            command={brewCommand}
            highlight={preferredMethod === "homebrew-cask"}
          />
        </div>

        <div className="mt-5 rounded-xl border border-dashed border-border/70 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          탐지한 명령어: <code className="font-mono">{detectedCommand}</code>
          <br />
          상태: {provider.diagnostics.statusText}
        </div>

        <div className="mt-6 flex justify-end">
          <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            다시 확인
          </Button>
        </div>
      </div>
    </div>
  );
}

function InstallCommandBlock({
  label,
  command,
  highlight,
}: {
  label: string;
  command: string;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-muted/40 px-3 py-2",
        highlight ? "border-foreground/40" : "border-border/70",
      )}
    >
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">
        {command}
      </pre>
    </div>
  );
}

function ProviderLoginRow({ provider }: { provider: ProviderAccountRecord }) {
  const codexLogin = useStartCodexLoginMutation();
  const isCodex = provider.provider === "codex";
  const isLoginInFlight = isCodex && codexLogin.isPending;
  const isProviderPending = provider.status === "pending";

  const supportsPrimary = provider.loginMethods.some(
    (method) => method.id === provider.primaryLoginMethodId && method.supported,
  );
  const cliInstalled = provider.diagnostics.installStatus === "installed";
  const disabled = isLoginInFlight || !supportsPrimary || !cliInstalled;

  function handleLogin() {
    if (isCodex) {
      void codexLogin.mutateAsync();
    }
  }

  const subtitle = !cliInstalled
    ? `${provider.providerLabel} CLI가 설치되어 있지 않습니다.`
    : isProviderPending
      ? "로그인 진행 중… 다시 시도하려면 버튼을 누르세요."
      : provider.statusText;

  const ButtonIcon = isLoginInFlight
    ? Loader2
    : isProviderPending
      ? RotateCw
      : LogIn;
  const buttonLabel = isProviderPending ? "다시 시도" : "로그인";

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
        aria-label={`${providerLabel(provider.provider)} ${buttonLabel}`}
      >
        <ButtonIcon
          className={cn("size-3.5", isLoginInFlight && "animate-spin")}
        />
        {buttonLabel}
      </Button>
    </div>
  );
}
