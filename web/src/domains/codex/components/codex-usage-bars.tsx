import { useId, useMemo, useState } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";

import { useProviderAccountsQuery, useProviderStatusesQuery } from "../hooks";
import type {
  ProviderAccountStatus,
  ProviderKind,
  ProviderStatusRecord,
  ProviderStatusUsageWindowRecord,
} from "../types";
import { Progress } from "@/shared/ui/progress";
import { cn } from "@/shared/lib/utils";
import { ProviderGlyph } from "./provider-glyph";
import {
  formatCliDiagnosticsSummary,
  formatUsageHeadline,
  providerAccountLabel,
  providerLabel,
} from "../lib/provider-display";

function formatTimeRemaining(resetAt: string | null): string | null {
  if (!resetAt) {
    return null;
  }

  const diffMs = new Date(resetAt).getTime() - Date.now();
  if (diffMs <= 0) {
    return "곧";
  }

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) {
    return `${diffMin}분`;
  }

  const diffHr = Math.floor(diffMin / 60);
  const remainMin = diffMin % 60;
  if (diffHr < 24) {
    return remainMin > 0 ? `${diffHr}시간 ${remainMin}분` : `${diffHr}시간`;
  }

  const diffDay = Math.floor(diffHr / 24);
  const remainHr = diffHr % 24;
  return remainHr > 0 ? `${diffDay}일 ${remainHr}시간` : `${diffDay}일`;
}

function indicatorColor(percent: number): string {
  if (percent <= 10) {
    return "bg-red-500";
  }
  if (percent <= 30) {
    return "bg-yellow-500";
  }
  return "bg-green-500";
}

function UsageWindow({
  label,
  window,
}: {
  label: string;
  window: ProviderStatusUsageWindowRecord;
}) {
  const remaining = window.remainingPercent;
  const timeLeft = formatTimeRemaining(window.resetAt);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-sidebar-foreground/55">{label}</span>
        <span
          className={cn(
            "truncate",
            remaining !== null && remaining <= 10
              ? "text-red-500"
              : remaining !== null && remaining <= 30
                ? "text-yellow-600"
                : "text-sidebar-foreground/70"
          )}
        >
          {formatUsageHeadline(window)}
          {timeLeft ? ` · ${timeLeft}` : ""}
        </span>
      </div>
      {remaining !== null ? (
        <Progress
          value={remaining}
          indicatorClassName={indicatorColor(remaining)}
          className="[&_[data-slot=progress-track]]:h-1 [&_[data-slot=progress-track]]:bg-sidebar-accent/80"
        />
      ) : null}
    </div>
  );
}

function ProviderUsageRow({
  provider,
  accountLabel,
  accountStatus,
  status,
  diagnosticsSummary,
}: {
  provider: ProviderKind;
  accountLabel: string;
  accountStatus: ProviderAccountStatus | null;
  status: ProviderStatusRecord | null;
  diagnosticsSummary: string | null;
}) {
  const accountStatusLabel =
    accountStatus === "authenticated"
      ? "로그인됨"
      : accountStatus === "pending"
        ? "연결 중"
        : accountStatus === "logged-out"
          ? "로그아웃"
          : accountStatus === "error"
            ? "오류"
            : "상태 확인 중";
  const accountStatusTone =
    accountStatus === "authenticated"
      ? "bg-emerald-500/10 text-emerald-700"
      : accountStatus === "pending"
        ? "bg-amber-500/10 text-amber-700"
        : accountStatus === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-sidebar-accent text-sidebar-foreground/65";

  return (
    <div className="rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/25 px-2.5 py-2.5">
      <div className="flex items-center gap-2">
        <ProviderGlyph provider={provider} className="size-5 bg-sidebar/80" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-sidebar-foreground">
              {providerLabel(provider)}
            </p>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                accountStatusTone
              )}
            >
              {accountStatusLabel}
            </span>
          </div>
          <div className="mt-1">
            <p className="min-w-0 truncate text-[10px] text-sidebar-foreground/55">
              {accountLabel}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {status ? (
          <>
            <UsageWindow label="5H" window={status.fiveHour} />
            <UsageWindow label="7D" window={status.weekly} />
          </>
        ) : (
          <p className="text-[10px] text-sidebar-foreground/55">사용량 상태를 불러오는 중입니다.</p>
        )}

        {diagnosticsSummary ? (
          <p className="truncate text-[10px] text-sidebar-foreground/42">
            {diagnosticsSummary}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CodexUsageBars() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const accountsQuery = useProviderAccountsQuery();
  const statusesQuery = useProviderStatusesQuery();

  const providerRows = useMemo(() => {
    const accountMap = new Map(
      (accountsQuery.data?.providers ?? []).map((provider) => [provider.provider, provider])
    );
    const statusMap = new Map(
      (statusesQuery.data?.providers ?? []).map((provider) => [provider.provider, provider])
    );

    return (["codex", "claude"] as Array<"codex" | "claude">).map((provider) => {
      const account = accountMap.get(provider) ?? null;

      return {
        provider,
        accountLabel: account
          ? providerAccountLabel(account.accountInfo) ?? account.statusText
          : "상태 확인 중",
        accountStatus: account?.status ?? null,
        diagnosticsSummary: account
          ? formatCliDiagnosticsSummary(account.diagnostics)
          : null,
        status: statusMap.get(provider) ?? null,
      };
    });
  }, [accountsQuery.data, statusesQuery.data]);

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Codex / Claude 연결 상태"
        aria-controls={panelId}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-2xl border border-transparent px-3 py-2 text-left transition hover:border-sidebar-border/70 hover:bg-sidebar-accent/50"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/40">
            연결 상태
          </p>
          <p className="mt-1 text-xs text-sidebar-foreground/65">로그인 상태 · 남은 사용량</p>
        </div>
        {open ? (
          <CaretUpIcon className="size-4 text-sidebar-foreground/45" />
        ) : (
          <CaretDownIcon className="size-4 text-sidebar-foreground/45" />
        )}
      </button>

      {open ? (
        <div id={panelId} className="mt-2 space-y-2 px-3 pb-2">
          {providerRows.map((row) => (
            <ProviderUsageRow key={row.provider} {...row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
