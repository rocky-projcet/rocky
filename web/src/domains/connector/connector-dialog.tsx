import { useEffect } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  TerminalSquare,
  Unplug,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";
import type { ConnectorProvider } from "@/shared/lib/agent-engine-client";

import {
  useConnectorCancelMutation,
  useConnectorDiagnosticsQuery,
  useConnectorDisconnectMutation,
  useConnectorLoginMutation,
  useConnectorStateQuery,
} from "./hooks";

interface ConnectorDialogProps {
  provider: ConnectorProvider;
  providerLabel: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConnected?: (accountLabel: string) => void;
}

export function ConnectorDialog({
  provider,
  providerLabel,
  open,
  onOpenChange,
  onConnected,
}: ConnectorDialogProps) {
  const stateQuery = useConnectorStateQuery(provider);
  const diagnosticsQuery = useConnectorDiagnosticsQuery(open);
  const loginMutation = useConnectorLoginMutation(provider);
  const cancelMutation = useConnectorCancelMutation(provider);
  const disconnectMutation = useConnectorDisconnectMutation(provider);

  const state = stateQuery.data;
  const diagnostics = diagnosticsQuery.data;
  const status = state?.status ?? "idle";
  const isConnecting = status === "connecting";
  const isConnected = status === "connected";

  useEffect(() => {
    if (state?.status === "connected" && state.accountLabel && open) {
      onConnected?.(state.accountLabel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.status, state?.accountLabel, open]);

  useEffect(() => {
    if (!open) {
      loginMutation.reset();
      cancelMutation.reset();
      disconnectMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chromiumMissing =
    diagnostics !== undefined && diagnostics.available === false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-5 sm:max-w-md">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-lg">{providerLabel} 연동</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            로그인은 별도 브라우저 창에서 직접 진행합니다. 완료되면 세션이 이 기기에만 저장돼요.
          </DialogDescription>
        </DialogHeader>

        <PrivacyNotice />

        {chromiumMissing ? (
          <ChromiumMissingPanel
            message={diagnostics?.message ?? ""}
            onRecheck={() => {
              void diagnosticsQuery.refetch();
            }}
            isRechecking={diagnosticsQuery.isFetching}
          />
        ) : isConnected ? (
          <ConnectedView
            accountLabel={state?.accountLabel ?? null}
            connectedAt={state?.connectedAt ?? null}
            onDisconnect={() => disconnectMutation.mutate()}
            disconnecting={disconnectMutation.isPending}
          />
        ) : isConnecting ? (
          <ConnectingView
            message={state?.message ?? "로그인 창에서 진행 중…"}
            providerLabel={providerLabel}
            onCancel={() => cancelMutation.mutate()}
            cancelling={cancelMutation.isPending}
          />
        ) : (
          <IdleView
            providerLabel={providerLabel}
            lastError={state?.lastError ?? null}
            onLogin={() => loginMutation.mutate()}
            starting={loginMutation.isPending}
            onClose={() => onOpenChange(false)}
            channelLabel={diagnostics?.channel ?? null}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PrivacyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-foreground" />
      <p>
        로그인은 이 컴퓨터에서 띄우는 브라우저 창에서 직접 이뤄지고, 세션은 이
        컴퓨터에만 저장됩니다. Rocky 서버나 외부로 이메일·비밀번호가 전송되지
        않아요.
      </p>
    </div>
  );
}

function IdleView({
  providerLabel,
  lastError,
  onLogin,
  starting,
  onClose,
  channelLabel,
}: {
  providerLabel: string;
  lastError: string | null;
  onLogin: () => void;
  starting: boolean;
  onClose: () => void;
  channelLabel: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      {lastError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {lastError}
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        버튼을 누르면 별도의 {channelLabel === "msedge" ? "Edge" : "Chrome"} 창이
        열립니다. 그 창에서 평소처럼 {providerLabel}에 로그인해 주세요. 캡차·2단계
        인증이 있다면 그 창에서 그대로 푸시면 돼요. 완료되면 창이 자동으로 닫힙니다.
      </p>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={starting}>
          취소
        </Button>
        <Button type="button" onClick={onLogin} disabled={starting}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
          {providerLabel} 창에서 로그인
        </Button>
      </DialogFooter>
    </div>
  );
}

function ConnectingView({
  message,
  providerLabel,
  onCancel,
  cancelling,
}: {
  message: string;
  providerLabel: string;
  onCancel: () => void;
  cancelling: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5",
          "border-foreground/15 bg-muted/40 text-foreground",
        )}
      >
        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
        <span>{message}</span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {providerLabel} 창에서 로그인을 마치고 창을 그대로 두시면 자동으로 감지해서
        세션을 저장합니다. 도중에 그만두려면 아래 취소를 누르고 창을 닫으세요.
      </p>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          취소
        </Button>
      </DialogFooter>
    </div>
  );
}

function ConnectedView({
  accountLabel,
  connectedAt,
  onDisconnect,
  disconnecting,
}: {
  accountLabel: string | null;
  connectedAt: string | null;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl border border-foreground/15 bg-foreground/[0.04] px-4 py-3">
        <CheckCircle2 className="size-5 text-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {accountLabel ?? "연동된 계정"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {connectedAt ? `연동 시각 ${formatTime(connectedAt)}` : "세션이 저장되어 있어요."}
          </p>
        </div>
      </div>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {disconnecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Unplug className="size-4" />
          )}
          연결 해제
        </Button>
      </DialogFooter>
    </div>
  );
}

function ChromiumMissingPanel({
  message,
  onRecheck,
  isRechecking,
}: {
  message: string;
  onRecheck: () => void;
  isRechecking: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
        <XCircle className="mt-0.5 size-3.5 shrink-0" />
        <span>자동 연동을 위한 브라우저를 찾지 못했어요.</span>
      </div>
      <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <TerminalSquare className="size-3.5" />
          해결 방법
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {message || "Chrome 또는 Edge가 설치되지 않았거나 Playwright Chromium이 누락됐어요."}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          시스템에 Chrome이 있다면 다른 작업 없이 그대로 동작해요. 그래도 안 되면 한 번만 실행해 주세요:
        </p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/70 bg-card px-3 py-2 font-mono text-xs text-foreground">
          npx playwright install chromium
        </pre>
      </div>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        <Button onClick={onRecheck} disabled={isRechecking}>
          {isRechecking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          다시 확인
        </Button>
      </DialogFooter>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
