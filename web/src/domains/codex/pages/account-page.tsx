import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Copy, ExternalLink, KeyRound } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { PageState } from "@/shared/components/page-state";
import { cn } from "@/shared/lib/utils";
import {
  useLoginCodexApiKeyMutation,
  useLogoutClaudeAccountMutation,
  useLogoutCodexAccountMutation,
  useProviderAccountsQuery,
  useProviderStatusesQuery,
  useStartClaudeUpdateMutation,
  useStartClaudeLoginMutation,
  useStartCodexUpdateMutation,
  useStartCodexDeviceAuthMutation,
  useStartCodexLoginMutation,
} from "../hooks";
import type {
  ClaudeAccountRecord,
  CodexAccountRecord,
  ProviderAccountRecord,
  ProviderStatusRecord,
} from "../types";
import { ProviderGlyph } from "../components/provider-glyph";
import {
  formatCliDiagnosticsSummary,
  formatUsageSummary,
  formatUsageWindowSummary,
  installMethodLabel,
  providerAccountLabel,
} from "../lib/provider-display";
import {
  shouldShowPendingAuthCard,
  shouldShowUpdateStatusCard,
} from "../lib/account-status-visibility";
import { HardwareStatusPanel } from "../components/hardware-status-panel";
import { buttonVariants } from "@/shared/ui/button";

const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const ORPHANED_SGR_PATTERN = /\[(?:\d{1,3};?)+m/g;

function sanitizeTerminalValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(ORPHANED_SGR_PATTERN, "")
    .replace(/\r/g, "")
    .trim();

  return sanitized.length > 0 ? sanitized : null;
}

function sanitizeTerminalLines(lines: string[]): string[] {
  return lines
    .map((line) => sanitizeTerminalValue(line))
    .filter((line): line is string => Boolean(line));
}

function statusTone(status: string): string {
  if (status === "authenticated") {
    return "bg-secondary text-secondary-foreground";
  }

  if (status === "pending") {
    return "bg-secondary text-secondary-foreground";
  }

  if (status === "error") {
    return "bg-destructive/15 text-destructive";
  }

  return "bg-secondary text-muted-foreground";
}

function latestStatusLabel(status: ProviderAccountRecord["diagnostics"]["latestStatus"]): string {
  switch (status) {
    case "current":
      return "최신";
    case "update-available":
      return "업데이트 가능";
    case "error":
      return "확인 실패";
    default:
      return "미확인";
  }
}

function updateStatusLabel(status: ProviderAccountRecord["update"]["status"]): string {
  switch (status) {
    case "pending":
      return "업데이트 중";
    case "completed":
      return "업데이트 완료";
    case "failed":
      return "업데이트 실패";
    default:
      return "대기";
  }
}

async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function DiagnosticsGrid({
  account,
  updateAction,
}: {
  account: ProviderAccountRecord;
  updateAction?: ReactNode;
}) {
  const diagnostics = account.diagnostics;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">설치 상태</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {diagnostics.installStatus === "installed" ? "설치됨" : "미설치"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {installMethodLabel(diagnostics.installMethod)}
        </p>
      </div>
      <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">현재 버전</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {diagnostics.currentVersion ?? "확인 불가"}
        </p>
      </div>
      <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">최신 여부</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {latestStatusLabel(diagnostics.latestStatus)}
        </p>
        {updateAction ? <div className="mt-3">{updateAction}</div> : null}
      </div>
    </div>
  );
}

function PendingAuthCard({
  verificationUri,
  code,
  instructions,
  lines,
  copiedField,
  onCopy,
}: {
  verificationUri: string | null;
  code: string | null;
  instructions: string | null;
  lines: string[];
  copiedField: "link" | "code" | null;
  onCopy: (value: string | null, field: "link" | "code") => Promise<void>;
}) {
  if (!verificationUri && !code && !instructions && lines.length === 0) {
    return null;
  }

  return (
    <Card className="gap-4 p-5">
      <div>
        <h4 className="text-sm font-semibold text-foreground">브라우저 인증 진행 중</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {instructions ?? "표시된 링크를 열고 인증을 완료하세요."}
        </p>
      </div>

      {verificationUri ? (
        <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">인증 링크</p>
          <div className="mt-2 flex items-center gap-2">
            <a
              href={verificationUri}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-sm font-medium text-foreground no-underline"
            >
              {verificationUri}
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void onCopy(verificationUri, "link");
              }}
            >
              {copiedField === "link" ? "복사됨" : <Copy size={14} />}
            </Button>
            <a
              href={verificationUri}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      ) : null}

      {code ? (
        <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">인증 코드</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-2xl bg-muted px-3 py-2 text-center text-base font-semibold">
              {code}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void onCopy(code, "code");
              }}
            >
              {copiedField === "code" ? "복사됨" : <Copy size={14} />}
            </Button>
          </div>
        </div>
      ) : null}

      {lines.length > 0 ? (
        <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">CLI 출력</p>
          <div className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            {lines.map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function UpdateStatusCard({
  account,
}: {
  account: ProviderAccountRecord;
}) {
  const output = sanitizeTerminalLines(account.update.output);
  const showCard = shouldShowUpdateStatusCard({
    updateStatus: account.update.status,
    updateSupported: account.update.supported,
    latestStatus: account.diagnostics.latestStatus,
  });

  if (!showCard) {
    return null;
  }

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">CLI 업데이트</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.update.commandPreview ??
              "이 설치 방식은 앱에서 자동 업데이트를 지원하지 않습니다."}
          </p>
        </div>
        <Badge className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusTone(account.update.status))}>
          {updateStatusLabel(account.update.status)}
        </Badge>
      </div>

      {account.update.lastError ? (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {account.update.lastError}
        </div>
      ) : null}

      {output.length > 0 ? (
        <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">CLI 출력</p>
          <div className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
            {output.map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ProviderSummary({
  account,
  status,
}: {
  account: ProviderAccountRecord;
  status: ProviderStatusRecord | null;
}) {
  const label = providerAccountLabel(account.accountInfo);
  const usageWindowSummary = status
    ? formatUsageWindowSummary([status.fiveHour, status.weekly])
    : null;

  return (
    <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
      <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">연결 계정</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {label ?? "로그인되지 않음"}
        </p>
        {account.accountInfo.planType || account.accountInfo.authMode ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {[account.accountInfo.planType, account.accountInfo.authMode]
              .filter(Boolean)
              .join(" / ")}
          </p>
        ) : null}
      </div>
      <div className="rounded-3xl border border-border/70 bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">사용량 상태</p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {usageWindowSummary ?? status?.statusText ?? "확인 중"}
        </p>
      </div>
    </div>
  );
}

function ProviderSettingsPanel() {
  const accountsQuery = useProviderAccountsQuery();
  const statusesQuery = useProviderStatusesQuery();
  const codexLoginMutation = useStartCodexLoginMutation();
  const codexDeviceMutation = useStartCodexDeviceAuthMutation();
  const codexApiKeyMutation = useLoginCodexApiKeyMutation();
  const codexUpdateMutation = useStartCodexUpdateMutation();
  const codexLogoutMutation = useLogoutCodexAccountMutation();
  const claudeLoginMutation = useStartClaudeLoginMutation();
  const claudeUpdateMutation = useStartClaudeUpdateMutation();
  const claudeLogoutMutation = useLogoutClaudeAccountMutation();
  const [codexAdvancedOpen, setCodexAdvancedOpen] = useState(false);
  const [claudeAdvancedOpen, setClaudeAdvancedOpen] = useState(false);
  const [codexApiKey, setCodexApiKey] = useState("");
  const [copiedField, setCopiedField] = useState<"link" | "code" | null>(null);

  const providerMaps = useMemo(() => {
    const accounts = new Map(
      (accountsQuery.data?.providers ?? []).map((provider) => [provider.provider, provider])
    );
    const statuses = new Map(
      (statusesQuery.data?.providers ?? []).map((provider) => [provider.provider, provider])
    );

    return {
      codexAccount: (accounts.get("codex") as CodexAccountRecord | undefined) ?? null,
      claudeAccount: (accounts.get("claude") as ClaudeAccountRecord | undefined) ?? null,
      codexStatus: statuses.get("codex") ?? null,
      claudeStatus: statuses.get("claude") ?? null,
    };
  }, [accountsQuery.data, statusesQuery.data]);

  if (accountsQuery.isLoading) {
    return (
      <PageState
        eyebrow="로딩"
        title="AI 서비스 상태를 불러오는 중입니다"
        description="Codex와 Claude 로그인 상태, 설치 상태, 사용량 정보를 읽고 있습니다."
      />
    );
  }

  if (accountsQuery.isError || !accountsQuery.data) {
    const error = accountsQuery.error;
    return (
      <PageState
        eyebrow="오류"
        title="AI 서비스 상태를 불러올 수 없습니다"
        description={
          error instanceof Error
            ? error.message
            : "현재 계정 및 CLI 상태를 불러올 수 없습니다."
        }
      />
    );
  }

  const { codexAccount, claudeAccount, codexStatus, claudeStatus } = providerMaps;
  if (!codexAccount || !claudeAccount) {
    return (
      <PageState
        eyebrow="누락"
        title="AI 서비스 정보를 찾을 수 없습니다"
        description="Codex 또는 Claude 서비스 응답이 비어 있습니다."
      />
    );
  }

  const codexBusy =
    codexLoginMutation.isPending ||
    codexDeviceMutation.isPending ||
    codexApiKeyMutation.isPending ||
    codexUpdateMutation.isPending ||
    codexLogoutMutation.isPending ||
    codexAccount.update.status === "pending";
  const claudeBusy =
    claudeLoginMutation.isPending ||
    claudeUpdateMutation.isPending ||
    claudeLogoutMutation.isPending ||
    claudeAccount.update.status === "pending";

  const codexCanLogin =
    !codexBusy && codexAccount.status !== "pending" && codexAccount.status !== "authenticated";
  const codexCanLogout = !codexBusy && codexAccount.status !== "logged-out";
  const claudeCanLogin =
    !claudeBusy &&
    claudeAccount.status !== "pending" &&
    claudeAccount.status !== "authenticated";
  const claudeCanLogout = !claudeBusy && claudeAccount.status !== "logged-out";
  const codexCanUpdate =
    codexAccount.update.supported &&
    !codexBusy &&
    codexAccount.diagnostics.latestStatus === "update-available";
  const claudeCanUpdate =
    claudeAccount.update.supported &&
    !claudeBusy &&
    claudeAccount.diagnostics.latestStatus === "update-available";

  const codexVerificationUri = sanitizeTerminalValue(codexAccount.deviceAuth.verificationUri);
  const codexUserCode = sanitizeTerminalValue(codexAccount.deviceAuth.userCode);
  const codexInstructions = sanitizeTerminalValue(codexAccount.deviceAuth.instructions);
  const codexOutput = sanitizeTerminalLines(codexAccount.deviceAuth.output);
  const showCodexPendingAuth = shouldShowPendingAuthCard({
    status: codexAccount.deviceAuth.status,
    verificationUri: codexVerificationUri,
    code: codexUserCode,
    instructions: codexInstructions,
    lineCount: codexOutput.length,
  });
  const claudeVerificationUri = sanitizeTerminalValue(
    claudeAccount.browserAuth.verificationUri
  );
  const claudeInstructions = sanitizeTerminalValue(
    claudeAccount.browserAuth.instructions
  );
  const showClaudePendingAuth = shouldShowPendingAuthCard({
    status: claudeAccount.browserAuth.status,
    verificationUri: claudeVerificationUri,
    code: null,
    instructions: claudeInstructions,
    lineCount: 0,
  });

  async function handleCopy(value: string | null, field: "link" | "code") {
    if (!value) {
      return;
    }

    const copied = await copyText(value);
    setCopiedField(copied ? field : null);
    if (copied) {
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
      }, 1500);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Codex와 Claude 연결 상태, 설치 여부, 버전 진단을 관리합니다. 추가 로그인 방식은 각 서비스의 고급 옵션에서 열 수 있습니다.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="gap-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <ProviderGlyph provider="codex" />
              <div>
                <h4 className="text-lg font-semibold text-foreground">Codex CLI</h4>
                <p className="text-sm text-muted-foreground">{codexAccount.statusText}</p>
              </div>
            </div>
            <Badge className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusTone(codexAccount.status))}>
              {codexAccount.status}
            </Badge>
          </div>

          <ProviderSummary account={codexAccount} status={codexStatus} />
          <DiagnosticsGrid
            account={codexAccount}
            updateAction={
              codexAccount.update.supported &&
              (codexCanUpdate || codexAccount.update.status === "pending") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void codexUpdateMutation.mutateAsync();
                  }}
                  disabled={!codexCanUpdate}
                >
                  {codexBusy && codexAccount.update.status === "pending"
                    ? "업데이트 중..."
                    : "업데이트"}
                </Button>
              ) : null
            }
          />
          <p className="text-sm text-muted-foreground">
            {formatCliDiagnosticsSummary(codexAccount.diagnostics)}
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                void codexLoginMutation.mutateAsync();
              }}
              disabled={!codexCanLogin}
            >
              {codexLoginMutation.isPending ? "로그인 중..." : "Codex 로그인"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void codexLogoutMutation.mutateAsync();
              }}
              disabled={!codexCanLogout}
            >
              {codexLogoutMutation.isPending ? "로그아웃 중..." : "로그아웃"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setCodexAdvancedOpen((current) => !current)}
            >
              고급 옵션
              {codexAdvancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>

          {codexAdvancedOpen ? (
            <div className="space-y-4 rounded-3xl border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Device auth</p>
                  <p className="text-sm text-muted-foreground">
                    수동 코드 입력 방식으로 로그인합니다.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    void codexDeviceMutation.mutateAsync();
                  }}
                  disabled={!codexCanLogin}
                >
                  {codexDeviceMutation.isPending ? "시작 중..." : "Device auth"}
                </Button>
              </div>

              <div className="space-y-3 rounded-3xl border border-border/70 bg-background px-4 py-4">
                <div className="flex items-center gap-2">
                  <KeyRound size={16} className="text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">API token 로그인</p>
                </div>
                <Label className="block">
                  <span className="text-xs text-muted-foreground">OpenAI API key</span>
                  <Input
                    type="password"
                    value={codexApiKey}
                    onChange={(event) => setCodexApiKey(event.target.value)}
                    placeholder="sk-..."
                    className="mt-2"
                  />
                </Label>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void codexApiKeyMutation.mutateAsync(codexApiKey.trim()).then(() => {
                        setCodexApiKey("");
                      });
                    }}
                    disabled={codexBusy || !codexApiKey.trim()}
                  >
                    {codexApiKeyMutation.isPending ? "로그인 중..." : "Token으로 로그인"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {showCodexPendingAuth ? (
            <PendingAuthCard
              verificationUri={codexVerificationUri}
              code={codexUserCode}
              instructions={codexInstructions}
              lines={codexOutput}
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          ) : null}
          <UpdateStatusCard account={codexAccount} />
        </Card>

        <Card className="gap-5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <ProviderGlyph provider="claude" />
              <div>
                <h4 className="text-lg font-semibold text-foreground">Claude Code</h4>
                <p className="text-sm text-muted-foreground">{claudeAccount.statusText}</p>
              </div>
            </div>
            <Badge className={cn("rounded-full px-3 py-1 text-xs font-semibold", statusTone(claudeAccount.status))}>
              {claudeAccount.status}
            </Badge>
          </div>

          <ProviderSummary account={claudeAccount} status={claudeStatus} />
          <DiagnosticsGrid
            account={claudeAccount}
            updateAction={
              claudeAccount.update.supported &&
              (claudeCanUpdate || claudeAccount.update.status === "pending") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void claudeUpdateMutation.mutateAsync();
                  }}
                  disabled={!claudeCanUpdate}
                >
                  {claudeBusy && claudeAccount.update.status === "pending"
                    ? "업데이트 중..."
                    : "업데이트"}
                </Button>
              ) : null
            }
          />
          <p className="text-sm text-muted-foreground">
            {formatCliDiagnosticsSummary(claudeAccount.diagnostics)}
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                void claudeLoginMutation.mutateAsync("claudeai");
              }}
              disabled={!claudeCanLogin}
            >
              {claudeLoginMutation.isPending ? "로그인 중..." : "Claude 로그인"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void claudeLogoutMutation.mutateAsync();
              }}
              disabled={!claudeCanLogout}
            >
              {claudeLogoutMutation.isPending ? "로그아웃 중..." : "로그아웃"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setClaudeAdvancedOpen((current) => !current)}
            >
              고급 옵션
              {claudeAdvancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>

          {claudeAdvancedOpen ? (
            <div className="rounded-3xl border border-border/70 bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Console login</p>
                  <p className="text-sm text-muted-foreground">
                    Anthropic Console 계정으로 로그인합니다.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    void claudeLoginMutation.mutateAsync("console");
                  }}
                  disabled={!claudeCanLogin}
                >
                  Console 로그인
                </Button>
              </div>
            </div>
          ) : null}

          {showClaudePendingAuth ? (
            <PendingAuthCard
              verificationUri={claudeVerificationUri}
              code={null}
              instructions={claudeInstructions}
              lines={[]}
              copiedField={copiedField}
              onCopy={handleCopy}
            />
          ) : null}
          <UpdateStatusCard account={claudeAccount} />
        </Card>
      </div>

      {codexLoginMutation.isError ||
      codexDeviceMutation.isError ||
      codexApiKeyMutation.isError ||
      codexUpdateMutation.isError ? (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {(codexLoginMutation.error ??
            codexDeviceMutation.error ??
            codexApiKeyMutation.error ??
            codexUpdateMutation.error) instanceof Error
            ? ((codexLoginMutation.error ??
                codexDeviceMutation.error ??
                codexApiKeyMutation.error ??
                codexUpdateMutation.error) as Error).message
            : "Codex 요청에 실패했습니다."}
        </div>
      ) : null}

      {claudeLoginMutation.isError ||
      claudeLogoutMutation.isError ||
      claudeUpdateMutation.isError ? (
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {(claudeLoginMutation.error ??
            claudeLogoutMutation.error ??
            claudeUpdateMutation.error) instanceof Error
            ? ((
                claudeLoginMutation.error ??
                claudeLogoutMutation.error ??
                claudeUpdateMutation.error
              ) as Error).message
            : "Claude 요청에 실패했습니다."}
        </div>
      ) : null}
    </section>
  );
}

export function AccountPage() {
  const [activeTab, setActiveTab] = useState("providers");

  return (
    <section className="space-y-6">
      <Card className="gap-0 bg-foreground p-6 text-primary-foreground">
        <p className="text-label-md uppercase text-primary-foreground/60">설정</p>
        <h3 className="mt-4 font-heading text-display-sm font-semibold">
          서비스 연결과 로컬 실행 환경
        </h3>
        <p className="mt-4 max-w-3xl text-body-lg leading-7 text-primary-foreground/80">
          AI 서비스 연결 상태와 로컬 AI 실행에 영향을 주는 하드웨어 상태를 한곳에서 확인합니다.
        </p>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="rounded-full bg-muted p-1">
            <TabsTrigger value="providers">AI 서비스</TabsTrigger>
            <TabsTrigger value="hardware">하드웨어 상태</TabsTrigger>
          </TabsList>
          <p className="text-sm text-muted-foreground">
            하드웨어 상태는 10초마다 자동으로 새로 읽습니다.
          </p>
        </div>

        <TabsContent value="providers" className="space-y-6">
          <ProviderSettingsPanel />
        </TabsContent>

        <TabsContent value="hardware" className="space-y-6">
          <HardwareStatusPanel enabled={activeTab === "hardware"} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
