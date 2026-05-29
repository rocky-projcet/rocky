import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpenText,
  Boxes,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  Factory,
  FileSpreadsheet,
  Hourglass,
  KeyRound,
  Landmark,
  type LucideIcon,
  Loader2,
  Plug,
  RadioTower,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import {
  siFacebook,
  siInstagram,
  siKakao,
  siMedium,
  siNaver,
  siThreads,
  siTiktok,
  siTistory,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

import { ConnectorDialog } from "@/domains/connector/connector-dialog";
import { useConnectorStateQuery } from "@/domains/connector/hooks";
import { agentEngineClient } from "@/shared/lib/api-client";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { cn } from "@/shared/lib/utils";
import type {
  ConnectorCapabilityRecord,
  ConnectorProvider,
  ConnectorState,
  EcountConnectionSettingsRecord,
  EcountConnectionTestRecord,
} from "@/shared/lib/agent-engine-client";

type IntegrationTab = "erp" | "sns";

interface ProviderEntry {
  provider: ConnectorProvider;
  label: string;
  description: string;
  brandIcon?: SimpleIcon;
  fallbackIcon?: LucideIcon;
  iconColor?: string;
}

type ErpStatus = "available" | "planned" | "manual" | "custom-api";

interface ErpProviderEntry {
  id: string;
  label: string;
  description: string;
  auth: string;
  status: ErpStatus;
  icon: LucideIcon;
  iconColor: string;
}

const ERP_PROVIDERS: ErpProviderEntry[] = [
  {
    id: "ecount",
    label: "ECOUNT ERP",
    description: "이카운트 테스트 API 키로 연결을 확인하고 조회 연동 준비 상태를 관리합니다.",
    auth: "회사코드, 키 발급자 ID, 테스트 API 인증키",
    status: "available",
    icon: Database,
    iconColor: "#059669",
  },
  {
    id: "douzone-wehago",
    label: "더존 / WEHAGO",
    description: "회계·세무·인사 데이터 연동 후보입니다.",
    auth: "API 앱, 토큰, 회사 권한 설정",
    status: "planned",
    icon: Landmark,
    iconColor: "#4f46e5",
  },
  {
    id: "sap",
    label: "SAP / SAP Business One",
    description: "대기업·제조 운영 데이터 연동 후보입니다.",
    auth: "OAuth, API token, tenant 설정",
    status: "planned",
    icon: Factory,
    iconColor: "#0284c7",
  },
  {
    id: "netsuite",
    label: "Oracle NetSuite",
    description: "글로벌 재무·재고·주문 데이터 연동 후보입니다.",
    auth: "Token-based auth, account realm",
    status: "planned",
    icon: Boxes,
    iconColor: "#d97706",
  },
  {
    id: "dynamics",
    label: "Microsoft Dynamics 365",
    description: "CRM·ERP 운영 데이터를 연결하는 후보입니다.",
    auth: "Microsoft OAuth, tenant, environment",
    status: "planned",
    icon: BriefcaseBusiness,
    iconColor: "#2563eb",
  },
  {
    id: "odoo",
    label: "Odoo",
    description: "오픈소스 ERP의 판매·재고·회계 데이터를 연결합니다.",
    auth: "URL, DB, 사용자, API key",
    status: "planned",
    icon: Building2,
    iconColor: "#9333ea",
  },
  {
    id: "custom-api",
    label: "직접 API",
    description: "사내 ERP나 커스텀 백오피스를 HTTP API로 연결합니다.",
    auth: "Base URL, headers, token",
    status: "custom-api",
    icon: ServerCog,
    iconColor: "#7c3aed",
  },
  {
    id: "file-based",
    label: "엑셀 / CSV",
    description: "API가 없거나 권한 준비 전인 ERP 데이터를 파일로 가져옵니다.",
    auth: "업로드 파일, 컬럼 매핑",
    status: "manual",
    icon: FileSpreadsheet,
    iconColor: "#16a34a",
  },
];

const SNS_PROVIDERS: ProviderEntry[] = [
  {
    provider: "threads",
    label: "Threads",
    description: "게시글 초안 발행과 계정 세션 확인에 사용합니다.",
    brandIcon: siThreads,
    iconColor: "#64748b",
  },
  {
    provider: "instagram",
    label: "Instagram",
    description: "피드·릴스 초안 발행 전 계정 세션을 준비합니다.",
    brandIcon: siInstagram,
    iconColor: "#e4405f",
  },
  {
    provider: "x",
    label: "X (트위터)",
    description: "짧은 글 발행과 캠페인 초안 확인에 사용합니다.",
    brandIcon: siX,
    iconColor: "#64748b",
  },
  {
    provider: "facebook",
    label: "Facebook",
    description: "페이지·게시물 작업용 로그인 상태를 저장합니다.",
    brandIcon: siFacebook,
    iconColor: "#1877f2",
  },
  {
    provider: "linkedin",
    label: "LinkedIn",
    description: "회사·개인 계정 기반 비즈니스 글 발행에 사용합니다.",
    fallbackIcon: BriefcaseBusiness,
    iconColor: "#0a66c2",
  },
  {
    provider: "tiktok",
    label: "TikTok",
    description: "숏폼 콘텐츠 작업용 세션을 연결합니다.",
    brandIcon: siTiktok,
    iconColor: "#ff0050",
  },
  {
    provider: "youtube",
    label: "YouTube",
    description: "YouTube Studio 작업과 쇼츠 업로드 준비에 사용합니다.",
    brandIcon: siYoutube,
    iconColor: "#ff0000",
  },
];

const CONTENT_PROVIDERS: ProviderEntry[] = [
  {
    provider: "naver-blog",
    label: "네이버 블로그",
    description: "블로그 글 초안 발행과 계정 확인에 사용합니다.",
    brandIcon: siNaver,
    iconColor: "#03c75a",
  },
  {
    provider: "tistory",
    label: "Tistory",
    description: "공식 API 종료로 커스텀 브라우저 세션을 준비합니다.",
    brandIcon: siTistory,
    iconColor: "#f97316",
  },
  {
    provider: "brunch",
    label: "브런치",
    description: "브런치 원고 발행 전 계정을 연결합니다.",
    fallbackIcon: BookOpenText,
    iconColor: "#059669",
  },
  {
    provider: "kakao-channel",
    label: "카카오 채널",
    description: "채널 포스트와 메시지 작업용 계정을 연결합니다.",
    brandIcon: siKakao,
    iconColor: "#b45309",
  },
  {
    provider: "medium",
    label: "Medium",
    description: "영문 콘텐츠 발행용 세션을 저장합니다.",
    brandIcon: siMedium,
    iconColor: "#334155",
  },
];

function iconColorStyle(color: string): { color: string } {
  return {
    color,
  };
}

function providerIconColor(entry: ProviderEntry): string {
  return entry.iconColor ?? (entry.brandIcon ? `#${entry.brandIcon.hex}` : "#64748b");
}

export function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<IntegrationTab>("erp");

  return (
    <PageContainer>
      <Tabs
        value={activeTab}
        onValueChange={(next) => setActiveTab(next as IntegrationTab)}
        className="gap-4"
      >
        <PageHeader
          title="연동"
          description="ERP와 SNS 계정을 한 곳에서 연결하고 상태를 확인합니다."
          belowSlot={
            <TabsList variant="line">
              <TabsTrigger value="erp">
                <Database className="size-4" />
                ERP
              </TabsTrigger>
              <TabsTrigger value="sns">
                <RadioTower className="size-4" />
                SNS·콘텐츠
              </TabsTrigger>
            </TabsList>
          }
        />

        <TabsContent value="erp">
          <div className="grid gap-5">
            <ErpProviderSection providers={ERP_PROVIDERS} />
          </div>
        </TabsContent>

        <TabsContent value="sns">
          <div className="grid gap-5">
            <ProviderSection
              title="SNS"
              description="소셜 채널 자동 발행과 계정 확인에 사용할 로그인 세션입니다."
              providers={SNS_PROVIDERS}
            />
            <ProviderSection
              title="블로그·콘텐츠"
              description="긴 글 발행 채널과 콘텐츠 플랫폼 계정을 관리합니다."
              providers={CONTENT_PROVIDERS}
            />
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function ErpProviderSection({ providers }: { providers: ErpProviderEntry[] }) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-foreground">ERP 공급자</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          ECOUNT ERP는 지금 설정할 수 있고, 다른 ERP는 같은 카드 구조로 준비 중입니다.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => (
          <ErpProviderCard key={provider.id} entry={provider} />
        ))}
      </div>
    </section>
  );
}

function ErpProviderCard({ entry }: { entry: ErpProviderEntry }) {
  const [open, setOpen] = useState(false);
  const [ecountConnection, setEcountConnection] =
    useState<EcountConnectionSettingsRecord>(() => emptyEcountConnectionSettings());
  const Icon = entry.icon;
  const available = entry.status === "available";
  const connected = available && ecountConnection.configured;

  useEffect(() => {
    if (entry.id === "ecount") {
      void agentEngineClient
        .getEcountConnectionSettings()
        .then(setEcountConnection)
        .catch(() => {
          setEcountConnection(emptyEcountConnectionSettings());
        });
    }
  }, [entry.id]);

  function openSettings() {
    if (available) {
      setOpen(true);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!available) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSettings();
    }
  }

  return (
    <>
      <article
        className={cn(
          "flex min-h-44 flex-col justify-between gap-4 rounded-2xl border border-border/70 bg-card p-4",
          available &&
            "cursor-pointer transition hover:border-emerald-500/40 hover:bg-emerald-500/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        role={available ? "button" : undefined}
        tabIndex={available ? 0 : undefined}
        onClick={openSettings}
        onKeyDown={handleKeyDown}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted"
                style={iconColorStyle(entry.iconColor)}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {entry.label}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {entry.description}
                </p>
              </div>
            </div>
            {connected ? <ConnectionBadge connected /> : <ErpStatusBadge status={entry.status} />}
          </div>

          {available ? (
            <div className="min-h-8 text-xs leading-5 text-muted-foreground">
              {ecountConnection.configured ? (
                <p>
                  <span className="font-medium text-foreground">
                    {ecountConnection.accountLabel ?? "이카운트 ERP"}
                  </span>
                  {ecountConnection.zone ? ` · ZONE ${ecountConnection.zone}` : ""}
                  {ecountConnection.checkedAt
                    ? ` · 마지막 확인 ${formatDateTime(ecountConnection.checkedAt)}`
                    : ""}
                </p>
              ) : (
                <p>카드를 눌러 연동 안내와 연결 테스트를 진행합니다.</p>
              )}
            </div>
          ) : null}

          <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2 text-xs leading-5">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <KeyRound className="size-3.5" />
              인증 방식
            </p>
            <p className="mt-1 text-muted-foreground">{entry.auth}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!available}
          className="justify-self-end"
          onClick={(event) => {
            event.stopPropagation();
            openSettings();
          }}
        >
          {available ? (
            connected ? (
              <RefreshCw className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )
          ) : entry.status === "planned" ? (
            <Hourglass className="size-4" />
          ) : (
            <ServerCog className="size-4" />
          )}
          {available
            ? connected
              ? "관리"
              : "설정"
            : entry.status === "planned"
            ? "준비 중"
            : entry.status === "manual"
              ? "파일 매핑 예정"
              : "설정 예정"}
        </Button>
      </article>

      {entry.id === "ecount" ? (
        <EcountConnectionDialog
          open={open}
          onOpenChange={setOpen}
          settings={ecountConnection}
          onConnectionChange={setEcountConnection}
        />
      ) : null}
    </>
  );
}

function ErpStatusBadge({ status }: { status: ErpStatus }) {
  if (status === "manual") {
    return (
      <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
        파일 기반
      </Badge>
    );
  }

  if (status === "custom-api") {
    return (
      <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300">
        직접 API
      </Badge>
    );
  }

  if (status === "available") {
    return (
      <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        지원됨
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      준비 중
    </Badge>
  );
}

function EcountConnectionDialog({
  open,
  onOpenChange,
  settings,
  onConnectionChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  settings: EcountConnectionSettingsRecord;
  onConnectionChange: (record: EcountConnectionSettingsRecord) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,780px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
          <DialogTitle>ECOUNT ERP 연동 설정</DialogTitle>
          <DialogDescription className="leading-6">
            OAPI 테스트 키를 저장하고 연결 상태를 확인합니다. ERP 등록·수정은 추후 제공 예정입니다.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 overflow-y-auto lg:grid-cols-[0.9fr_1.1fr]">
          <EcountSetupGuide />
          <EcountConnectionPanel
            settings={settings}
            onConnectionChange={onConnectionChange}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EcountSetupGuide() {
  return (
    <aside className="grid content-start gap-4 border-b border-border/70 bg-muted/20 p-5 text-xs leading-5 text-muted-foreground lg:border-b-0 lg:border-r">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">OAPI 준비 순서</p>
        <Button
          variant="outline"
          size="sm"
          render={
            <a
              href="https://login.ecount.com/Login/?lan_type=ko-KR"
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <ExternalLink className="size-4" />
          이카운트 로그인
        </Button>
      </div>

      <ol className="grid gap-2.5">
        <SetupStep number="1">
          이카운트 홈페이지에서 OAPI 매뉴얼 또는 API 키 발급 화면으로 이동합니다.
        </SetupStep>
        <SetupStep number="2">
          테스트 API 키를 발급하고, 발급 행에 표시된 발급자 ID와 유효기간을 확인합니다.
        </SetupStep>
        <SetupStep number="3">
          웹 로그인 ID가 아니라 테스트 키를 발급한 ID를 입력합니다.
        </SetupStep>
        <SetupStep number="4">
          테스트 통과 후 이카운트 화면에서 정식 연동 키 발급 절차를 진행합니다.
        </SetupStep>
      </ol>

      <div className="grid gap-1.5 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
        <p className="font-medium text-foreground">현재 제공 범위</p>
        <p>지금은 연결 테스트와 조회 연동 준비까지만 지원합니다. ERP 등록·수정·삭제는 실행하지 않습니다.</p>
      </div>

      <div className="grid gap-1.5 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
        <p className="font-medium text-foreground">테스트 실패 시 확인</p>
        <p>API_CERT_KEY 오류는 키 발급자 ID 불일치일 수 있습니다. 키 상태 탭에서 해당 테스트 키 행의 발급자 ID를 확인하세요.</p>
        <p>IP 오류나 코드 205가 나오면 API 키 발급 화면에서 현재 접속 IP를 등록한 뒤 다시 테스트합니다.</p>
      </div>
    </aside>
  );
}

function SetupStep({ number, children }: { number: string; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold text-foreground">
        {number}
      </span>
      <span>{children}</span>
    </li>
  );
}

function EcountConnectionPanel({
  settings,
  onConnectionChange,
  onClose,
}: {
  settings: EcountConnectionSettingsRecord;
  onConnectionChange: (record: EcountConnectionSettingsRecord) => void;
  onClose: () => void;
}) {
  const [stored, setStored] = useState<EcountConnectionSettingsRecord>(settings);
  const [accountLabel, setAccountLabel] = useState(settings.accountLabel ?? "");
  const [comCode, setComCode] = useState("");
  const [userId, setUserId] = useState("");
  const [apiCertKey, setApiCertKey] = useState("");
  const [zone, setZone] = useState(settings.zone ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<EcountConnectionTestRecord | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    title: string;
    detail: string;
  } | null>(null);

  useEffect(() => {
    setStored(settings);
    setAccountLabel(settings.accountLabel ?? "");
    setZone(settings.zone ?? "");
  }, [settings]);

  const hasInlineInput = Boolean(comCode.trim() || userId.trim() || apiCertKey.trim());
  const hasCompleteInlineInput = Boolean(
    comCode.trim() && userId.trim() && apiCertKey.trim()
  );
  const canTest = hasCompleteInlineInput || (stored.configured && !hasInlineInput);
  const canSave = hasCompleteInlineInput;
  const connected = stored.configured;

  function buildInlineInput() {
    return {
      accountLabel: accountLabel.trim() || null,
      comCode: comCode.trim(),
      userId: userId.trim(),
      apiCertKey: apiCertKey.trim(),
      zone: zone.trim() || null,
      lanType: "ko-KR",
    };
  }

  async function saveSettings() {
    if (!canSave) return;
    setSaving(true);
    setNotice(null);
    try {
      const next = await agentEngineClient.saveEcountConnectionSettings(buildInlineInput());
      setStored(next);
      onConnectionChange(next);
      setAccountLabel(next.accountLabel ?? "");
      setZone(next.zone ?? "");
      setComCode("");
      setUserId("");
      setApiCertKey("");
      setResult(null);
      setNotice({
        kind: "success",
        title: "설정을 저장했습니다.",
        detail: "이제 저장된 값으로 연결 테스트를 실행할 수 있습니다.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        title: "설정 저장 실패",
        detail: error instanceof Error ? error.message : "설정을 저장하지 못했습니다.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setResult(null);
    setNotice(null);
    try {
      const next = await agentEngineClient.testEcountConnection(
        hasCompleteInlineInput ? buildInlineInput() : null,
      );
      setResult(next);
      if (next.ok) {
        const nextStored = await agentEngineClient.getEcountConnectionSettings();
        setStored(nextStored);
        onConnectionChange(nextStored);
        setAccountLabel(nextStored.accountLabel ?? "");
        setZone(nextStored.zone ?? "");
        setComCode("");
        setUserId("");
        setApiCertKey("");
      }
    } catch (error) {
      setResult({
        ok: false,
        status: "failed",
        accountLabel: accountLabel.trim() || null,
        comCode: comCode.trim(),
        userId: userId.trim(),
        zone: zone.trim() || null,
        checkedAt: new Date().toISOString(),
        message: "ECOUNT connection test failed.",
        diagnostics: {
          stage: "login",
          detail: error instanceof Error ? error.message : "연결 테스트를 실행하지 못했습니다.",
        },
      });
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setNotice(null);
    try {
      const next = await agentEngineClient.deleteEcountConnectionSettings();
      setStored(next);
      setResult(null);
      onConnectionChange(next);
      setAccountLabel("");
      setZone("");
      setComCode("");
      setUserId("");
      setApiCertKey("");
    } catch (error) {
      setNotice({
        kind: "error",
        title: "연결 해제 실패",
        detail: error instanceof Error ? error.message : "저장된 설정을 삭제하지 못했습니다.",
      });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Database className="size-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">연동 정보</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                테스트 API 키로 ZONE 조회와 세션 발급을 확인합니다.
              </p>
            </div>
          </div>
        </div>
        <ConnectionBadge connected={connected} />
      </div>

      {stored.configured ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {stored.accountLabel ?? "이카운트 ERP"}
            </p>
            <p className="text-xs text-muted-foreground">
              {stored.zone ? `ZONE ${stored.zone} · ` : ""}
              {stored.checkedAt
                ? `마지막 확인 ${formatDateTime(stored.checkedAt)}`
                : "저장된 설정"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              회사코드 {stored.comCodeMasked ?? "-"} · 발급자 ID {stored.userIdMasked ?? "-"} ·
              키 {stored.apiCertKeyMasked ?? "-"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={disconnect}
            disabled={disconnecting || saving || testing}
          >
            {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
            연결 해제
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <EcountFormField label="계정 별칭" htmlFor="ecount-account-label">
          <Input
            id="ecount-account-label"
            value={accountLabel}
            onChange={(event) => setAccountLabel(event.target.value)}
            placeholder="예: 본사 ERP"
          />
        </EcountFormField>
        <EcountFormField label="ZONE" htmlFor="ecount-zone" helper="모르면 비워두면 자동 조회합니다.">
          <Input
            id="ecount-zone"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            placeholder="예: CC"
          />
        </EcountFormField>
        <EcountFormField label="회사코드" htmlFor="ecount-com-code">
          <Input
            id="ecount-com-code"
            value={comCode}
            onChange={(event) => setComCode(event.target.value)}
            placeholder="COM_CODE"
          />
        </EcountFormField>
        <EcountFormField label="API 키 발급자 ID" htmlFor="ecount-user-id">
          <Input
            id="ecount-user-id"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="USER_ID"
          />
        </EcountFormField>
        <EcountFormField
          className="sm:col-span-2"
          label="테스트 API 인증키"
          htmlFor="ecount-api-cert-key"
          helper="저장하면 백엔드에서 암호화하고, 화면에는 다시 표시하지 않습니다."
        >
          <Input
            id="ecount-api-cert-key"
            type="password"
            value={apiCertKey}
            onChange={(event) => setApiCertKey(event.target.value)}
            placeholder="API_CERT_KEY"
          />
        </EcountFormField>
      </div>

      {!hasCompleteInlineInput ? (
        <p className="text-xs leading-5 text-muted-foreground">
          회사코드, 발급자 ID, 인증키를 모두 입력하면 설정을 저장할 수 있습니다.
          저장된 설정이 있으면 입력칸을 비운 상태로 연결 테스트를 실행할 수 있습니다.
        </p>
      ) : null}

      {notice ? <EcountNotice notice={notice} /> : null}
      {result ? <EcountResult result={result} /> : null}

      <DialogFooter className="flex-col-reverse items-stretch border-t border-border/70 pt-4 sm:flex-row sm:items-center">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving || testing || disconnecting}>
          <X className="size-4" />
          닫기
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={saveSettings}
          disabled={!canSave || saving || testing || disconnecting}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          설정 저장
        </Button>
        <Button
          type="button"
          onClick={runTest}
          disabled={!canTest || saving || testing || disconnecting}
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
          연결 테스트
        </Button>
      </DialogFooter>
    </section>
  );
}

function EcountFormField({
  className,
  label,
  htmlFor,
  helper,
  children,
}: {
  className?: string;
  label: string;
  htmlFor: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {helper ? <p className="text-xs leading-5 text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function EcountNotice({
  notice,
}: {
  notice: {
    kind: "success" | "error";
    title: string;
    detail: string;
  };
}) {
  const success = notice.kind === "success";
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        success
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <div className="flex items-start gap-2">
        {success ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        ) : (
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-medium">{notice.title}</p>
          <p className="mt-1 text-xs leading-5 opacity-80">{notice.detail}</p>
        </div>
      </div>
    </div>
  );
}

function EcountResult({ result }: { result: EcountConnectionTestRecord }) {
  return (
    <div
      className={cn(
        "mt-4 rounded-xl border px-4 py-3 text-sm",
        result.ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <div className="flex items-start gap-2">
        {result.ok ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        ) : (
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-medium">
            {result.ok ? "세션 발급까지 확인했습니다." : "연결 테스트 실패"}
          </p>
          <p className="mt-1 text-xs leading-5 opacity-80">
            {result.ok
              ? result.zone
                ? `ZONE ${result.zone} 서버에서 로그인했습니다.`
                : result.message
              : result.diagnostics?.detail ?? result.message}
          </p>
        </div>
      </div>
    </div>
  );
}

function ProviderSection({
  title,
  description,
  providers,
}: {
  title: string;
  description: string;
  providers: ProviderEntry[];
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => (
          <ProviderCard key={provider.provider} entry={provider} />
        ))}
      </div>
    </section>
  );
}

function ProviderCard({ entry }: { entry: ProviderEntry }) {
  const stateQuery = useConnectorStateQuery(entry.provider);
  const state = stateQuery.data;
  const [open, setOpen] = useState(false);

  const status = state?.status ?? "idle";
  const connected = status === "connected";
  const connecting = status === "connecting";
  const planned = status === "planned";
  const awaitingVerification =
    connecting && state?.loginMode === "external-browser";
  const failed = status === "failed";

  return (
    <article className="flex min-h-44 flex-col justify-between gap-4 rounded-2xl border border-border/70 bg-card p-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted"
              style={iconColorStyle(providerIconColor(entry))}
            >
              <ProviderIcon entry={entry} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {entry.label}
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {entry.description}
              </p>
            </div>
          </div>
          <ConnectionBadge
            connected={connected}
            connecting={connecting}
            awaitingVerification={awaitingVerification}
            failed={failed}
            planned={planned}
          />
        </div>

        <div className="min-h-8 text-xs leading-5 text-muted-foreground">
          {connected ? (
            <p>
              <span className="font-medium text-foreground">
                {state?.accountLabel ?? "연동된 계정"}
              </span>
              {state?.connectedAt ? ` · ${formatDateTime(state.connectedAt)}` : null}
            </p>
          ) : planned ? (
            <p>{state?.message ?? `${entry.label} 연동은 준비 중입니다.`}</p>
          ) : failed ? (
            <p className="text-destructive">{state?.lastError ?? state?.message}</p>
          ) : connecting ? (
            <p>{state?.message ?? "로그인 창에서 진행 중입니다."}</p>
          ) : (
            <p>아직 연결된 계정이 없습니다.</p>
          )}
        </div>
        {entry.provider === "instagram" && state ? (
          <InstagramCardSummary state={state} />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant={connected ? "outline" : "default"}
          size="sm"
          onClick={() => setOpen(true)}
          disabled={planned}
        >
          {planned ? (
            <Hourglass className="size-4" />
          ) : connected ? (
            <RefreshCw className="size-4" />
          ) : (
            <ExternalLink className="size-4" />
          )}
          {planned ? "준비 중" : connected ? "관리" : awaitingVerification ? "상태" : "로그인 열기"}
        </Button>
        {stateQuery.isFetching ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      <ConnectorDialog
        provider={entry.provider}
        providerLabel={entry.label}
        open={open}
        onOpenChange={setOpen}
      />
    </article>
  );
}

function InstagramCardSummary({ state }: { state: ConnectorState }) {
  const readiness = state.readiness;
  const blockers = readiness.blockers;
  const graphReady = blockers.length === 0;
  const keyCapabilities = state.capabilities.filter((capability) =>
    [
      "instagram.account.read",
      "instagram.media.prepare",
      "instagram.media.publish",
      "instagram.insights.read",
    ].includes(capability.id),
  );

  return (
    <div className="grid gap-2 text-[11px] leading-5 text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            graphReady
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
          )}
        >
          {graphReady ? "Graph API 준비 완료" : "Graph API 설정 필요"}
        </Badge>
        <Badge variant="outline">
          {formatInstagramAccountKind(readiness.accountKind)}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {keyCapabilities.map((capability) => (
          <InstagramCapabilityChip
            key={capability.id}
            capability={capability}
          />
        ))}
      </div>
      {!graphReady && blockers[0] ? (
        <p>
          {formatInstagramBlockerCode(blockers[0].code)}:{" "}
          {formatInstagramBlockerAction(blockers[0].code, blockers[0].nextAction)}
        </p>
      ) : null}
    </div>
  );
}

function InstagramCapabilityChip({
  capability,
}: {
  capability: ConnectorCapabilityRecord;
}) {
  const status = capability.status ?? "available";
  const shortId = formatInstagramCapabilityName(capability.id);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        status === "available" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "blocked" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        status === "planned" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {shortId} {formatInstagramCapabilityStatus(status)}
    </span>
  );
}

function formatInstagramAccountKind(kind: ConnectorState["readiness"]["accountKind"]) {
  if (kind === "professional_business") return "비즈니스";
  if (kind === "professional_creator") return "크리에이터";
  if (kind === "personal") return "개인";
  return "알 수 없음";
}

function formatInstagramCapabilityName(id: string) {
  if (id === "instagram.account.read") return "계정 확인";
  if (id === "instagram.media.prepare") return "미디어 준비";
  if (id === "instagram.media.publish") return "미디어 게시";
  if (id === "instagram.insights.read") return "인사이트";
  return id.replace("instagram.", "");
}

function formatInstagramCapabilityStatus(
  status: ConnectorCapabilityRecord["status"],
) {
  if (status === "available") return "사용 가능";
  if (status === "blocked") return "차단됨";
  if (status === "planned") return "준비 중";
  if (status === "unsupported") return "미지원";
  return "사용 가능";
}

function formatInstagramBlockerCode(
  code: ConnectorState["readiness"]["blockers"][number]["code"],
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

function formatInstagramBlockerAction(
  code: ConnectorState["readiness"]["blockers"][number]["code"],
  fallback: string,
) {
  if (code === "professional_account_required") {
    return "Instagram 계정을 Business 또는 Creator로 전환한 뒤 다시 연결하세요.";
  }
  if (code === "meta_app_required") {
    return "Rocky 관리 OAuth 브로커 설정을 확인한 뒤 Graph API 연결을 다시 시작하세요.";
  }
  if (code === "app_access_required") {
    return "Meta/Instagram에서 Rocky 앱 테스트 사용자 또는 앱 역할 초대를 수락한 뒤 다시 연결하세요.";
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
  return fallback;
}

function ProviderIcon({ entry }: { entry: ProviderEntry }) {
  if (entry.brandIcon) {
    return (
      <svg
        aria-hidden="true"
        className="size-4"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d={entry.brandIcon.path} />
      </svg>
    );
  }

  const Icon = entry.fallbackIcon ?? RadioTower;
  return <Icon className="size-4" />;
}

function ConnectionBadge({
  connected,
  connecting = false,
  awaitingVerification = false,
  failed = false,
  planned = false,
}: {
  connected: boolean;
  connecting?: boolean;
  awaitingVerification?: boolean;
  failed?: boolean;
  planned?: boolean;
}) {
  if (connected) {
    return (
      <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        연결됨
      </Badge>
    );
  }

  if (awaitingVerification) {
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        <ExternalLink className="size-3" />
        미검증
      </Badge>
    );
  }

  if (connecting) {
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        진행 중
      </Badge>
    );
  }

  if (failed) {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        실패
      </Badge>
    );
  }

  if (planned) {
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        <Hourglass className="size-3" />
        준비 중
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      미연동
    </Badge>
  );
}

function emptyEcountConnectionSettings(): EcountConnectionSettingsRecord {
  return {
    configured: false,
    accountLabel: null,
    comCodeMasked: null,
    userIdMasked: null,
    apiCertKeyMasked: null,
    zone: null,
    checkedAt: null,
    updatedAt: null,
  };
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
