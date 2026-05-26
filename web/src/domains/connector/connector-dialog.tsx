import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Hourglass,
  Loader2,
  Lock,
  ShieldCheck,
  Unplug,
  UserPlus,
  X,
} from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";
import type {
  ConnectorCapabilityRecord,
  ConnectorProvider,
  ConnectorReadinessRecord,
  ConnectorState,
} from "@/shared/lib/agent-engine-client";

import {
  useConnectorCancelMutation,
  useConnectorDisconnectMutation,
  useConnectorGraphDiscoveryMutation,
  useConnectorLoginMutation,
  useConnectorTesterRequestMutation,
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
  const graphDiscoveryMutation = useConnectorGraphDiscoveryMutation(provider);
  const testerRequestMutation = useConnectorTesterRequestMutation(provider);
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
      graphDiscoveryMutation.reset();
      testerRequestMutation.reset();
      cancelMutation.reset();
      disconnectMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startLogin = () => {
    loginMutation.mutate();
  };

  const startGraphDiscovery = () => {
    const loginWindow = window.open("about:blank", "_blank");
    if (loginWindow) {
      try {
        loginWindow.opener = null;
      } catch {
        // Some browser contexts do not allow mutating opener on the returned handle.
      }
    }

    graphDiscoveryMutation.mutate(undefined, {
      onSuccess: (nextState) => {
        if (!nextState.loginUrl) {
          loginWindow?.close();
          return;
        }

        if (loginWindow && !loginWindow.closed) {
          loginWindow.location.assign(nextState.loginUrl);
          return;
        }

        window.open(nextState.loginUrl, "_blank", "noopener,noreferrer");
      },
      onError: () => {
        loginWindow?.close();
      },
    });
  };

  const submitTesterRequest = (accountIdentifier: string, status?: "accepted") => {
    testerRequestMutation.mutate({ accountIdentifier, status });
  };

  const openLoginUrl = () => {
    if (state?.loginUrl) {
      window.open(state.loginUrl, "_blank", "noopener,noreferrer");
    }
  };

  if (provider === "instagram") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92vh,760px)] flex-col gap-5 overflow-y-auto sm:max-w-2xl">
          <InstagramGraphApiView
            state={state}
            providerLabel={providerLabel}
            onGraphDiscovery={startGraphDiscovery}
            graphStarting={graphDiscoveryMutation.isPending}
            onTesterRequest={submitTesterRequest}
            testerRequesting={testerRequestMutation.isPending}
            onBrowserLogin={startLogin}
            browserStarting={loginMutation.isPending}
            onOpenLoginUrl={openLoginUrl}
            onCancel={() => cancelMutation.mutate()}
            cancelling={cancelMutation.isPending}
            onDisconnect={() => disconnectMutation.mutate()}
            disconnecting={disconnectMutation.isPending}
            onClose={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

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

function InstagramGraphApiView({
  state,
  providerLabel,
  onGraphDiscovery,
  graphStarting,
  onTesterRequest,
  testerRequesting,
  onBrowserLogin,
  browserStarting,
  onOpenLoginUrl,
  onCancel,
  cancelling,
  onDisconnect,
  disconnecting,
  onClose,
}: {
  state: ConnectorState | undefined;
  providerLabel: string;
  onGraphDiscovery: () => void;
  graphStarting: boolean;
  onTesterRequest: (accountIdentifier: string, status?: "accepted") => void;
  testerRequesting: boolean;
  onBrowserLogin: () => void;
  browserStarting: boolean;
  onOpenLoginUrl: () => void;
  onCancel: () => void;
  cancelling: boolean;
  onDisconnect: () => void;
  disconnecting: boolean;
  onClose: () => void;
}) {
  const readiness = state?.readiness ?? emptyReadiness();
  const blockers = readiness.blockers;
  const capabilities = (state?.capabilities ?? []).filter((capability) =>
    capability.id.startsWith("instagram."),
  );
  const browserConnected =
    state?.status === "connected" && state.loginMode === "custom-browser";
  const connecting = state?.status === "connecting";
  const loginUrl = state?.loginUrl ?? null;
  const graphReady = Boolean(state) && blockers.length === 0;
  const graphConnected =
    state?.status === "connected" && state.loginMode === "oauth" && graphReady;
  const testerBlocked = blockers.some(
    (blocker) => blocker.code === "app_access_required",
  );
  const busy =
    graphStarting ||
    browserStarting ||
    testerRequesting ||
    cancelling ||
    disconnecting;

  return (
    <>
      <DialogHeader className="gap-2">
        <DialogTitle className="text-lg">{providerLabel} Graph API 설정</DialogTitle>
        <DialogDescription className="text-sm leading-6">
          Instagram 실행에는 Business 또는 Creator 프로페셔널 계정, Meta 앱,
          승인된 권한, 액세스 토큰, Instagram Business Account ID가 필요합니다.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className="size-4" />
              Graph API 조건
            </p>
            <Badge variant="outline">{formatSetupMode(readiness.setupMode)}</Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <dt>계정 종류</dt>
              <dd className="font-medium text-foreground">
                {formatAccountKind(readiness.accountKind)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>브라우저 세션</dt>
              <dd className="font-medium text-foreground">
                {readiness.browserSessionPurpose === "readiness_check"
                  ? "준비 확인"
                  : "수동 보조"}
              </dd>
            </div>
          </dl>
        </div>

        <div
          className={cn(
            "rounded-xl border p-3 text-xs leading-5",
            graphReady
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
          )}
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            {graphReady ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <AlertCircle className="size-4" />
            )}
            {graphReady ? "Graph API 준비 완료" : "설정 확인 필요"}
          </p>
          {graphReady ? (
            <p className="mt-2">
              필요한 계정, 앱, 토큰, 권한, Business Account ID 신호를
              확인했습니다.
            </p>
          ) : (
            <ul className="mt-2 grid gap-1.5">
              {blockers.map((blocker) => (
                <li key={blocker.code}>
                  <span className="font-medium">{formatBlockerCode(blocker.code)}</span>
                  : {formatBlockerAction(blocker.code, blocker.nextAction)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {testerBlocked || state?.testerRequest ? (
        <TesterRequestPanel
          request={state?.testerRequest ?? null}
          disabled={busy || connecting}
          submitting={testerRequesting}
          onSubmit={onTesterRequest}
        />
      ) : null}

      <div className="rounded-xl border border-border/70 p-3">
        <p className="mb-2 text-sm font-medium text-foreground">기능 상태</p>
        <div className="grid gap-2">
          {capabilities.map((capability) => (
            <CapabilityRow key={capability.id} capability={capability} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <p className="flex items-start gap-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-foreground" />
          <span>
            브라우저 로그인은 수동 보조와 준비 확인에만 사용합니다. 쿠키,
            세션 저장소, 브라우저 프로필 경로는 Instagram 기능 실행 자격
            증명으로 사용하지 않습니다.
          </span>
        </p>
      </div>

      {state?.lastError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {state.lastError}
        </div>
      ) : null}

      <DialogFooter className="flex-col-reverse items-stretch sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          <X className="size-4" />
          닫기
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {browserConnected ? (
            <Button
              type="button"
              variant="outline"
              onClick={onDisconnect}
              disabled={graphStarting || browserStarting || disconnecting}
            >
              {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
              브라우저 확인 해제
            </Button>
          ) : null}
          {connecting ? (
            <>
              {loginUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onOpenLoginUrl}
                  disabled={cancelling}
                >
                  <ExternalLink className="size-4" />
                  승인 화면 열기
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onCancel} disabled={cancelling}>
                {cancelling ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                확인 취소
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onBrowserLogin}
                disabled={graphStarting || browserStarting || disconnecting}
              >
                {browserStarting ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                {browserConnected ? "브라우저 확인 다시 실행" : "브라우저 보조 로그인"}
              </Button>
              {graphConnected ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onDisconnect}
                  disabled={graphStarting || browserStarting || disconnecting}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                  Graph API 연결 해제
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={onGraphDiscovery}
                  disabled={graphStarting || browserStarting || disconnecting}
                >
                  {graphStarting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  Graph API 연결
                </Button>
              )}
            </>
          )}
        </div>
      </DialogFooter>
    </>
  );
}

function TesterRequestPanel({
  request,
  disabled,
  submitting,
  onSubmit,
}: {
  request: ConnectorState["testerRequest"] | null;
  disabled: boolean;
  submitting: boolean;
  onSubmit: (accountIdentifier: string, status?: "accepted") => void;
}) {
  const [accountIdentifier, setAccountIdentifier] = useState(
    request?.accountIdentifier ?? "",
  );

  useEffect(() => {
    if (request?.accountIdentifier) {
      setAccountIdentifier(request.accountIdentifier);
    }
  }, [request?.accountIdentifier]);

  const trimmed = accountIdentifier.trim();
  const canSubmit = trimmed.length > 0 && !disabled;
  const canRecordAccepted =
    Boolean(request) && request?.status !== "accepted" && request?.status !== "completed";

  return (
    <form
      className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit(trimmed);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserPlus className="size-4" />
            테스터 등록 요청
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {request
              ? formatTesterRequestStatus(request.status)
              : "Instagram username 또는 초대에 필요한 계정 식별자를 기록합니다."}
          </p>
        </div>
        {request ? (
          <Badge variant="outline" className="shrink-0">
            {formatTesterRequestBadge(request.status)}
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2">
        <Label htmlFor="instagram-tester-account" className="text-xs">
          Instagram 계정 식별자
        </Label>
        <Input
          id="instagram-tester-account"
          value={accountIdentifier}
          onChange={(event) => setAccountIdentifier(event.currentTarget.value)}
          placeholder="@rocky_account"
          disabled={disabled}
          autoComplete="off"
        />
      </div>

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {canRecordAccepted ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => onSubmit(trimmed || request?.accountIdentifier || "", "accepted")}
            disabled={disabled || submitting || !(trimmed || request?.accountIdentifier)}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            초대 수락 기록
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          요청 기록
        </Button>
      </div>
    </form>
  );
}

function CapabilityRow({ capability }: { capability: ConnectorCapabilityRecord }) {
  const status = capability.status ?? "available";
  const copy = formatInstagramCapability(capability);
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">
          {copy.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {copy.description}
        </p>
      </div>
      <Badge
        variant={status === "available" ? "default" : "outline"}
        className={cn(
          "shrink-0",
          status === "available" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          status === "blocked" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
          status === "planned" && "border-border bg-muted text-muted-foreground",
        )}
      >
        {status === "available" ? <CheckCircle2 className="size-3" /> : <CircleDashed className="size-3" />}
        {formatCapabilityStatus(status)}
      </Badge>
    </div>
  );
}

function emptyReadiness(): ConnectorReadinessRecord {
  return {
    setupMode: "graph-api",
    accountKind: "unknown",
    browserSessionPurpose: "readiness_check",
    blockers: [],
  };
}

function formatSetupMode(mode: ConnectorReadinessRecord["setupMode"]) {
  if (mode === "graph-api") return "Graph API";
  if (mode === "oauth") return "OAuth";
  if (mode === "custom-browser") return "브라우저 확인";
  return "미정";
}

function formatAccountKind(kind: ConnectorReadinessRecord["accountKind"]) {
  if (kind === "professional_business") return "비즈니스";
  if (kind === "professional_creator") return "크리에이터";
  if (kind === "personal") return "개인";
  return "알 수 없음";
}

function formatCapabilityStatus(status: ConnectorCapabilityRecord["status"]) {
  if (status === "available") return "사용 가능";
  if (status === "blocked") return "차단됨";
  if (status === "planned") return "준비 중";
  if (status === "unsupported") return "미지원";
  return "사용 가능";
}

function formatTesterRequestStatus(
  status: NonNullable<ConnectorState["testerRequest"]>["status"],
) {
  if (status === "invited") {
    return "Rocky 운영자가 테스터 초대를 보낸 상태입니다. Meta/Instagram에서 수락한 뒤 아래에 기록하세요.";
  }
  if (status === "accepted") {
    return "테스터 초대 수락이 기록되었습니다. Graph API 연결을 다시 진행할 수 있습니다.";
  }
  if (status === "completed") {
    return "테스터 게이트가 완료되었고 Graph API 토큰이 발급되었습니다.";
  }
  return "테스터 등록 요청이 기록되었습니다. 운영자 초대 후 수락하면 다시 연결할 수 있습니다.";
}

function formatTesterRequestBadge(
  status: NonNullable<ConnectorState["testerRequest"]>["status"],
) {
  if (status === "invited") return "초대 보냄";
  if (status === "accepted") return "수락 기록";
  if (status === "completed") return "완료";
  return "대기 중";
}

function formatBlockerCode(
  code: ConnectorReadinessRecord["blockers"][number]["code"],
) {
  if (code === "professional_account_required") return "프로페셔널 계정 필요";
  if (code === "facebook_page_required") return "Facebook 페이지 필요";
  if (code === "meta_business_setup_required") return "Meta Business 설정 필요";
  if (code === "meta_app_required") return "Meta 앱 필요";
  if (code === "app_access_required") return "앱 접근 승인 필요";
  if (code === "permission_missing") return "권한 필요";
  if (code === "app_review_required") return "앱 검수 필요";
  if (code === "access_token_missing") return "액세스 토큰 필요";
  if (code === "token_expired") return "토큰 갱신 필요";
  if (code === "instagram_business_account_id_missing") {
    return "Instagram Business Account ID 필요";
  }
  if (code === "rocky_capability_not_implemented") return "기능 구현 대기";
  return code;
}

function formatBlockerAction(
  code: ConnectorReadinessRecord["blockers"][number]["code"],
  fallback: string,
) {
  if (code === "professional_account_required") {
    return "Instagram 계정을 Business 또는 Creator로 전환한 뒤 다시 연결하세요.";
  }
  if (code === "facebook_page_required") {
    return "Instagram 계정과 연결된 Facebook 페이지를 준비하세요.";
  }
  if (code === "meta_business_setup_required") {
    return "Meta Business 설정에서 Instagram 계정과 앱 권한을 확인하세요.";
  }
  if (code === "meta_app_required") {
    return "Meta 앱 Client ID와 Secret을 설정한 뒤 Graph API 연결을 다시 시작하세요.";
  }
  if (code === "app_access_required") {
    return "Meta/Instagram에서 Rocky 앱 테스트 사용자 또는 앱 역할 초대를 수락한 뒤 다시 연결하세요.";
  }
  if (code === "permission_missing") {
    return "필요한 Instagram Graph API 권한을 승인하세요.";
  }
  if (code === "app_review_required") {
    return "개발 모드 테스트 사용자가 아니면 Meta 앱 검수를 완료하세요.";
  }
  if (code === "access_token_missing") {
    return "OAuth를 다시 진행해 액세스 토큰을 발급하세요.";
  }
  if (code === "token_expired") {
    return "Rocky가 토큰 갱신을 시도했지만 실패했습니다. Instagram을 다시 연결하세요.";
  }
  if (code === "instagram_business_account_id_missing") {
    return "Instagram Business Account ID를 확인하거나 Graph API 연결을 다시 진행하세요.";
  }
  if (code === "rocky_capability_not_implemented") {
    return "Rocky에서 해당 실행 기능이 제공될 때까지 기다려야 합니다.";
  }
  return fallback;
}

function formatInstagramCapability(capability: ConnectorCapabilityRecord) {
  if (capability.id === "instagram.account.read") {
    return {
      label: "계정 확인",
      description:
        "설정된 Instagram Business Account ID와 Graph API 준비 상태를 확인합니다.",
    };
  }
  if (capability.id === "instagram.media.prepare") {
    return {
      label: "미디어 준비",
      description:
        "Graph API 계정과 토큰 준비가 확인된 뒤 Instagram 게시 작업을 준비합니다.",
    };
  }
  if (capability.id === "instagram.media.publish") {
    return {
      label: "미디어 게시",
      description:
        "미리보기와 명시적 승인 뒤 Graph API로 Instagram 미디어를 게시합니다.",
    };
  }
  if (capability.id === "instagram.media.status.read") {
    return {
      label: "게시 상태 확인",
      description: "Graph API로 Instagram 미디어 게시 상태를 확인합니다.",
    };
  }
  if (capability.id === "instagram.insights.read") {
    return {
      label: "인사이트 조회",
      description:
        "승인된 Graph API 권한으로 Instagram 계정과 미디어 인사이트를 읽습니다.",
    };
  }
  if (capability.id === "instagram.automation.prepare") {
    return {
      label: "자동화 준비 확인",
      description:
        "Instagram 네이티브 기능을 Graph API 자격 증명으로 실행할 수 있는지 확인합니다.",
    };
  }
  return {
    label: capability.label || capability.id,
    description: capability.description,
  };
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
