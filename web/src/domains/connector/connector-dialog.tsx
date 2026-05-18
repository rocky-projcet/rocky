import { useEffect } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Hourglass,
  Loader2,
  Lock,
  Unplug,
  X,
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
  const loginMutation = useConnectorLoginMutation(provider);
  const cancelMutation = useConnectorCancelMutation(provider);
  const disconnectMutation = useConnectorDisconnectMutation(provider);

  const state = stateQuery.data;
  const status = state?.status ?? "idle";
  const loginMode = state?.loginMode ?? null;
  const isConnecting = status === "connecting";
  const isConnected = status === "connected";
  const isPlanned = status === "planned";

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

  const startLogin = () => {
    loginMutation.mutate();
  };

  const openLoginUrl = () => {
    if (state?.loginUrl) {
      window.open(state.loginUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-5 sm:max-w-md">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-lg">{providerLabel} 연동</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            공식 OAuth 또는 커스텀 브라우저 확인이 완료된 경우에만 연결됨으로 표시합니다.
          </DialogDescription>
        </DialogHeader>

        <PrivacyNotice />

        {isConnected ? (
          <ConnectedView
            accountLabel={state?.accountLabel ?? null}
            connectedAt={state?.connectedAt ?? null}
            onDisconnect={() => disconnectMutation.mutate()}
            disconnecting={disconnectMutation.isPending}
          />
        ) : isPlanned ? (
          <PlannedView
            providerLabel={providerLabel}
            message={state?.message ?? `${providerLabel} 연동은 준비 중입니다.`}
            onClose={() => onOpenChange(false)}
          />
        ) : isConnecting ? (
          <ConnectingView
            message={state?.message ?? "로그인 창에서 진행 중…"}
            providerLabel={providerLabel}
            loginMode={loginMode}
            loginUrl={state?.loginUrl ?? null}
            lastError={state?.lastError ?? null}
            onOpenLoginUrl={openLoginUrl}
            onCancel={() => cancelMutation.mutate()}
            cancelling={cancelMutation.isPending}
          />
        ) : (
          <IdleView
            providerLabel={providerLabel}
            lastError={state?.lastError ?? null}
            onLogin={startLogin}
            starting={loginMutation.isPending}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlannedView({
  providerLabel,
  message,
  onClose,
}: {
  providerLabel: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <Hourglass className="mt-0.5 size-3.5 shrink-0 text-foreground" />
        <span>{message}</span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {providerLabel} 계정 연결은 아직 열지 않았습니다. 준비가 끝나면 이 화면에서 바로 연결할 수 있게 바뀝니다.
      </p>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </DialogFooter>
    </div>
  );
}

function PrivacyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-foreground" />
      <p>
        공식 OAuth는 callback 코드를 토큰으로 교환합니다. 공식 API가 없는 서비스는
        별도 브라우저에서 로그인 완료를 감지하고 세션 상태만 저장합니다.
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
}: {
  providerLabel: string;
  lastError: string | null;
  onLogin: () => void;
  starting: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {lastError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {lastError}
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        버튼을 누르면 {providerLabel} 계정 연결을 시작합니다. 공식 OAuth가 있는
        서비스는 승인 화면을, 없는 서비스는 커스텀 로그인 브라우저를 엽니다.
      </p>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={starting}>
          취소
        </Button>
        <Button type="button" onClick={onLogin} disabled={starting}>
          {starting ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
          계정 연결
        </Button>
      </DialogFooter>
    </div>
  );
}

function ConnectingView({
  message,
  providerLabel,
  loginMode,
  loginUrl,
  lastError,
  onOpenLoginUrl,
  onCancel,
  cancelling,
}: {
  message: string;
  providerLabel: string;
  loginMode: string | null;
  loginUrl: string | null;
  lastError: string | null;
  onOpenLoginUrl: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const customBrowser = loginMode === "custom-browser";
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5",
          "border-foreground/15 bg-muted/40 text-foreground",
        )}
      >
        <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
        <span>{message}</span>
      </div>
      {lastError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {lastError}
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        {customBrowser
          ? `${providerLabel} 로그인 창에서 로그인을 마치면 연결됨으로 바뀝니다. 창을 닫으면 연결이 취소될 수 있습니다.`
          : `${providerLabel} 승인 화면에서 권한을 허용하면 callback에서 토큰을 교환하고 연결됨으로 바뀝니다.`}
      </p>
      <DialogFooter className="flex flex-row items-center justify-end gap-2">
        {loginUrl ? (
          <Button
            type="button"
            variant="outline"
            onClick={onOpenLoginUrl}
            disabled={cancelling}
          >
            <ExternalLink className="size-4" />
            다시 열기
          </Button>
        ) : null}
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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
