import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderKanban,
  PlayCircle,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AgentWorkspaceBrowserPanel } from "@/domains/agent/components/agent-workspace-browser-panel";
import { useRuntimesQuery } from "@/domains/codex/hooks";
import {
  rockyQueryKeys,
  useCheckRockyAppUpdateMutation,
  useDownloadRockyAppUpdateMutation,
  useRockyAppUpdateQuery,
  useRockyChatsQuery,
  useRockyCoreManagementQuery,
  useStartRockyAppUpdateInstallerMutation,
  useSyncRockyCoreSkillsMutation,
  useUpdateRockyCoreSettingsMutation,
} from "@/domains/rocky/hooks";
import {
  appUpdateStatusLabel,
  canInstallAppUpdate,
  primaryAppUpdateActionLabel,
} from "@/domains/rocky/lib/app-update";
import { ROCKY_CORE_AGENT_SPEC } from "@/domains/rocky/lib/rocky-agent-catalog";
import { agentEngineClient } from "@/shared/lib/api-client";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
  AppUpdateRecord,
} from "@/shared/lib/agent-engine-client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

const SESSION_QUERY_KEY = ["rocky-core-agent-sessions", ROCKY_CORE_AGENT_SPEC.id] as const;

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function runtimeLabel(kind: RuntimeKind): string {
  switch (kind) {
    case "claude-code":
      return "Claude Code";
    case "ollama":
      return "Ollama";
    case "codex-cli":
    default:
      return "Codex CLI";
  }
}

function modelDisplay(value: string | null): string {
  return value?.trim() || "CLI 기본값";
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "실행 중";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소됨";
    default:
      return "대기";
  }
}

function AppUpdatePanel({
  runningSessionCount,
}: {
  runningSessionCount: number;
}) {
  const updateQuery = useRockyAppUpdateQuery();
  const checkMutation = useCheckRockyAppUpdateMutation();
  const downloadMutation = useDownloadRockyAppUpdateMutation();
  const installMutation = useStartRockyAppUpdateInstallerMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const record = updateQuery.data ?? null;
  const busy =
    updateQuery.isLoading ||
    checkMutation.isPending ||
    downloadMutation.isPending ||
    installMutation.isPending ||
    record?.status === "checking" ||
    record?.status === "installing";
  const canInstall = record ? canInstallAppUpdate(record) : false;

  async function handleRecordResult(
    result: AppUpdateRecord,
    successMessage: string
  ) {
    if (result.status === "failed") {
      toast.error("Rocky 업데이트를 진행하지 못했습니다.", {
        description: result.lastError ?? undefined,
      });
      return;
    }
    toast.success(successMessage);
  }

  async function handlePrimaryAction() {
    if (!record || busy) {
      return;
    }

    try {
      if (record.status === "update-available") {
        const result = await downloadMutation.mutateAsync();
        await handleRecordResult(result, "설치 파일을 검증했습니다.");
        return;
      }

      if (record.status === "downloaded") {
        setConfirmOpen(true);
        return;
      }

      const result = await checkMutation.mutateAsync();
      await handleRecordResult(result, "최신 버전을 확인했습니다.");
    } catch (error) {
      toast.error("Rocky 업데이트 요청이 실패했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function handleInstallConfirm() {
    try {
      const result = await installMutation.mutateAsync();
      setConfirmOpen(false);
      await handleRecordResult(result, "설치 파일을 실행했습니다.");
    } catch (error) {
      toast.error("설치 파일을 실행하지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  const statusText = record
    ? appUpdateStatusLabel(record)
    : updateQuery.isError
      ? "상태 확인 실패"
      : "불러오는 중";
  const primaryLabel = record
    ? primaryAppUpdateActionLabel(record)
    : "업데이트 확인";
  const primaryDisabled =
    !record ||
    busy ||
    record.status === "unsupported" ||
    (record.status === "downloaded" && !canInstall);
  const checksumText = record?.download?.sha256 ?? record?.installerAsset?.sha256 ?? null;
  const preserved = record?.preservedPathNames ?? [];

  return (
    <section className="rounded-lg border bg-card p-5 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              Rocky Windows 업데이트
            </h3>
            <Badge variant={record?.updateAvailable ? "secondary" : "outline"}>
              {statusText}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            현재 버전과 GitHub Release의 Windows 설치 파일을 확인합니다.
          </p>
        </div>
        <ShieldCheck className="size-5 text-muted-foreground" />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border bg-background px-3 py-3">
          <div className="text-xs text-muted-foreground">현재 버전</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {record?.currentVersion ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border bg-background px-3 py-3">
          <div className="text-xs text-muted-foreground">최신 버전</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {record?.latestVersion ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border bg-background px-3 py-3">
          <div className="text-xs text-muted-foreground">설치 파일</div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {record?.download?.fileName ?? record?.installerAsset?.name ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border bg-background px-3 py-3">
          <div className="text-xs text-muted-foreground">검증</div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {record?.download?.verified
              ? "완료"
              : record?.installerAsset?.sha256
                ? "checksum 확보"
                : "대기"}
          </div>
        </div>
      </div>

      {record?.lastError ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{record.lastError}</span>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="rounded-lg border bg-background px-3 py-3 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">보존 경로</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {preserved.map((name) => (
              <Badge key={name} variant="outline">
                {name}
              </Badge>
            ))}
          </div>
          {checksumText ? (
            <div className="mt-3 break-all font-mono text-xs">
              sha256:{checksumText}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {record?.releaseUrl ? (
            <Button
              type="button"
              variant="outline"
              render={<a href={record.releaseUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink className="size-4" />
              Release
            </Button>
          ) : null}
          <Button type="button" onClick={() => void handlePrimaryAction()} disabled={primaryDisabled}>
            {record?.status === "update-available" ? (
              <Download className="size-4" />
            ) : record?.status === "downloaded" ? (
              <PlayCircle className="size-4" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {busy ? "처리 중" : primaryLabel}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Rocky 설치 파일을 실행할까요?"
        description={`진행 중인 세션 ${runningSessionCount}개가 있을 수 있습니다. 설치 프로그램 실행 후 Rocky가 재시작될 수 있으며, .runtime, .codex, .tools, .env 파일은 보존 대상입니다.`}
        confirmLabel="설치 실행"
        cancelLabel="취소"
        pending={installMutation.isPending}
        onConfirm={() => void handleInstallConfirm()}
      />
    </section>
  );
}

export function RockyAgentPage() {
  const queryClient = useQueryClient();
  const chatsQuery = useRockyChatsQuery();
  const managementQuery = useRockyCoreManagementQuery();
  const runtimesQuery = useRuntimesQuery();
  const updateSettingsMutation = useUpdateRockyCoreSettingsMutation();
  const syncSkillsMutation = useSyncRockyCoreSkillsMutation();
  const coreAgent = managementQuery.data?.agent ?? null;
  const sessionsQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () =>
      agentEngineClient.listAgentSessions(ROCKY_CORE_AGENT_SPEC.id, {
        includeArchived: true,
      }),
    enabled: Boolean(coreAgent?.id),
  });
  const deleteSessionMutation = useMutation({
    mutationFn: (input: { sessionId: string; stopRunningRuns: boolean }) =>
      agentEngineClient.deleteSession(input.sessionId, {
        stopRunningRuns: input.stopRunningRuns,
      }),
    onSuccess: async () => {
      toast.success("세션을 삭제했습니다.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: rockyQueryKeys.coreManagement }),
      ]);
    },
    onError: (error) => {
      toast.error("세션을 삭제하지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    },
  });

  const settings = managementQuery.data?.settings;
  const sessions = sessionsQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const latestSession = [...sessions].sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt)
  )[0];
  const latestChat = [...chats].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )[0];

  const [draftRuntime, setDraftRuntime] = useState<RuntimeKind>("codex-cli");
  const [draftModel, setDraftModel] = useState("");
  const [draftReasoning, setDraftReasoning] = useState<"default" | RuntimeReasoningEffort>(
    "default"
  );
  const [draftServiceTier, setDraftServiceTier] = useState<
    "default" | RuntimeServiceTier
  >("default");
  const [draftOllamaTarget, setDraftOllamaTarget] =
    useState<RuntimeOllamaLaunchTarget>("codex");

  useEffect(() => {
    if (!settings) {
      return;
    }
    setDraftRuntime(settings.defaultRuntimeKind);
    setDraftModel(settings.defaultModel ?? "");
    setDraftReasoning(settings.defaultReasoningEffort ?? "default");
    setDraftServiceTier(settings.defaultServiceTier ?? "default");
    setDraftOllamaTarget(settings.defaultOllamaLaunchTarget ?? "codex");
  }, [settings]);

  const runtimeOptions = runtimesQuery.data ?? [];
  const selectedRuntime = useMemo(
    () => runtimeOptions.find((runtime) => runtime.kind === draftRuntime) ?? null,
    [draftRuntime, runtimeOptions]
  );
  const modelOptions = selectedRuntime?.modelOptions ?? [];
  const selectedModelOption = useMemo(() => {
    const selectedModelId = draftModel.trim();
    if (selectedModelId) {
      return modelOptions.find((option) => option.id === selectedModelId) ?? null;
    }

    return (
      modelOptions.find((option) => option.id === selectedRuntime?.defaultModel) ??
      null
    );
  }, [draftModel, modelOptions, selectedRuntime?.defaultModel]);
  const reasoningOptions = selectedModelOption?.supportedReasoningEfforts ?? [];
  const serviceTierOptions = selectedModelOption?.supportedServiceTiers ?? [];
  const canSaveSettings =
    Boolean(settings) && !updateSettingsMutation.isPending && !managementQuery.isLoading;

  useEffect(() => {
    if (
      draftReasoning !== "default" &&
      !reasoningOptions.includes(draftReasoning)
    ) {
      setDraftReasoning("default");
    }
  }, [draftReasoning, reasoningOptions]);

  useEffect(() => {
    if (
      draftServiceTier !== "default" &&
      !serviceTierOptions.includes(draftServiceTier)
    ) {
      setDraftServiceTier("default");
    }
  }, [draftServiceTier, serviceTierOptions]);

  async function handleSaveSettings() {
    await updateSettingsMutation.mutateAsync({
      defaultRuntimeKind: draftRuntime,
      defaultModel: draftModel.trim() || null,
      defaultReasoningEffort:
        draftRuntime === "ollama" || draftReasoning === "default"
          ? null
          : draftReasoning,
      defaultServiceTier:
        draftRuntime === "ollama" || draftServiceTier === "default"
          ? null
          : draftServiceTier,
      defaultOllamaLaunchTarget:
        draftRuntime === "ollama" ? draftOllamaTarget : null,
    });
    toast.success("Rocky Core 기본 모델을 저장했습니다.");
  }

  async function handleSyncSkills() {
    await syncSkillsMutation.mutateAsync();
    toast.success("Rocky Core 스킬을 동기화했습니다.");
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }

  if (managementQuery.isLoading || chatsQuery.isLoading) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
        <h3 className="text-lg font-semibold text-foreground">Rocky Core 상태 준비 중</h3>
      </Card>
    );
  }

  if (managementQuery.isError || chatsQuery.isError || sessionsQuery.isError) {
    const error =
      (managementQuery.error instanceof Error && managementQuery.error.message) ||
      (chatsQuery.error instanceof Error && chatsQuery.error.message) ||
      (sessionsQuery.error instanceof Error && sessionsQuery.error.message) ||
      "Rocky Core 상태를 불러오지 못했습니다.";

    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-destructive/10 px-8 py-10 text-center">
        <div>
          <h3 className="text-lg font-semibold text-destructive">
            Rocky Core 상태를 불러올 수 없습니다
          </h3>
          <p className="mt-3 text-sm text-destructive">{error}</p>
        </div>
      </Card>
    );
  }

  const health = managementQuery.data?.sessionHealth;
  const runningSessions = sessions.filter((session) => session.status === "running");

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <Card className="shrink-0 gap-0 bg-foreground p-6 text-primary-foreground">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-primary-foreground/65">
              Rocky 전용
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Rocky Core</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-foreground/80">
              홈 화면 대화, Core 세션, 기본 모델, 워크스페이스 스킬을 한 곳에서 관리합니다.
            </p>
          </div>
          <Badge variant="secondary">{coreAgent ? "준비됨" : "첫 대화 후 생성"}</Badge>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">저장된 홈 대화</div>
            <div className="mt-1 text-2xl font-semibold">{health?.homeChatCount ?? 0}</div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">전체 Core 세션</div>
            <div className="mt-1 text-2xl font-semibold">
              {health?.existingSessionCount ?? sessions.length}
            </div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">진행 중 세션</div>
            <div className="mt-1 text-2xl font-semibold">{runningSessions.length}</div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">끊어진 참조</div>
            <div className="mt-1 text-2xl font-semibold">
              {health?.danglingSessionIds.length ?? 0}
            </div>
          </div>
        </div>
      </Card>

      <div className="custom-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
          <section className="rounded-lg border bg-card p-5 xl:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">기본 모델</h3>
                  <Badge variant="outline">{runtimeLabel(settings?.defaultRuntimeKind ?? "codex-cli")}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  새 홈 대화 세션부터 적용됩니다. 기존 세션은 저장된 설정을 유지합니다.
                </p>
              </div>
              <Settings2 className="size-5 text-muted-foreground" />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium text-foreground">Runtime</span>
                <Select
                  value={draftRuntime}
                  onValueChange={(value) => setDraftRuntime(value as RuntimeKind)}
                >
                  <SelectTrigger className="w-full rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runtimeOptions.map((runtime) => (
                      <SelectItem key={runtime.kind} value={runtime.kind}>
                        {runtime.label}
                      </SelectItem>
                    ))}
                    {runtimeOptions.length === 0 ? (
                      <SelectItem value="codex-cli">Codex CLI</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-foreground">모델</span>
                <Input
                  value={draftModel}
                  list="rocky-core-model-options"
                  placeholder="비우면 CLI 기본값"
                  onChange={(event) => setDraftModel(event.target.value)}
                />
                <datalist id="rocky-core-model-options">
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-foreground">Reasoning</span>
                <Select
                  value={draftReasoning}
                  onValueChange={(value) =>
                    setDraftReasoning(value as "default" | RuntimeReasoningEffort)
                  }
                  disabled={draftRuntime === "ollama" || reasoningOptions.length === 0}
                >
                  <SelectTrigger className="w-full rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">기본값</SelectItem>
                    {reasoningOptions.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {effort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium text-foreground">Service tier</span>
                <Select
                  value={draftServiceTier}
                  onValueChange={(value) =>
                    setDraftServiceTier(value as "default" | RuntimeServiceTier)
                  }
                  disabled={draftRuntime === "ollama" || serviceTierOptions.length === 0}
                >
                  <SelectTrigger className="w-full rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">기본값</SelectItem>
                    {serviceTierOptions.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {tier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {draftRuntime === "ollama" ? (
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-foreground">Ollama 실행 대상</span>
                  <Select
                    value={draftOllamaTarget}
                    onValueChange={(value) =>
                      setDraftOllamaTarget(value as RuntimeOllamaLaunchTarget)
                    }
                  >
                    <SelectTrigger className="w-full rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3">
              <div className="text-sm text-muted-foreground">
                현재 기본값: {runtimeLabel(settings?.defaultRuntimeKind ?? "codex-cli")} ·{" "}
                {modelDisplay(settings?.defaultModel ?? null)}
                {settings?.defaultReasoningEffort
                  ? ` · ${settings.defaultReasoningEffort}`
                  : ""}
                {settings?.defaultServiceTier ? ` · ${settings.defaultServiceTier}` : ""}
              </div>
              <Button
                type="button"
                onClick={() => void handleSaveSettings()}
                disabled={!canSaveSettings}
              >
                <Save className="size-4" />
                저장
              </Button>
            </div>

            {selectedModelOption ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {selectedModelOption.label}
              </p>
            ) : null}
          </section>

          <AppUpdatePanel runningSessionCount={runningSessions.length} />

          <section className="rounded-lg border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    워크스페이스
                  </h3>
                  <Badge variant={coreAgent ? "secondary" : "outline"}>
                    {coreAgent ? "활성" : "대기"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Core 작업 폴더를 탐색하고 파일 내용을 바로 확인합니다.
                </p>
              </div>
              <FolderKanban className="size-5 text-muted-foreground" />
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">Workspace</div>
                <div className="mt-1 break-all font-mono text-xs text-foreground">
                  {coreAgent?.workspaceRoot ?? "아직 생성되지 않음"}
                </div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">Runtime Home</div>
                <div className="mt-1 break-all font-mono text-xs text-foreground">
                  {coreAgent?.runtimeHome ?? "아직 생성되지 않음"}
                </div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">최근 홈 대화</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {latestChat?.title ?? "아직 없음"}
                </div>
              </div>
            </div>

            <div className="mt-5 h-[34rem] min-h-[28rem] rounded-lg border bg-background p-4">
              {coreAgent ? (
                <AgentWorkspaceBrowserPanel
                  agentId={coreAgent.id}
                  workspaceRoot={coreAgent.workspaceRoot}
                  showHeader={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted px-4 text-sm text-muted-foreground">
                  첫 홈 대화가 생성되면 Rocky Core 워크스페이스를 탐색할 수 있습니다.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">세션</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  홈 대화가 참조하는 Core 세션 상태를 확인하고 정리합니다.
                </p>
              </div>
              <Activity className="size-5 text-muted-foreground" />
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">최근 세션 활동</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {formatDateTime(latestSession?.lastActivityAt)}
                </div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">세션 없는 대화</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {health?.chatsWithoutSessionIds ?? 0}개
                </div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">누락된 세션 참조</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {health?.chatsWithMissingSessions ?? 0}개 대화
                </div>
              </div>
            </div>

            <div className="mt-5 divide-y rounded-lg border bg-background">
              {sessions.length === 0 ? (
                <div className="px-4 py-5 text-sm text-muted-foreground">
                  저장된 Core 세션이 없습니다.
                </div>
              ) : (
                sessions.slice(0, 8).map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {session.title ?? session.id}
                        </span>
                        <Badge
                          variant={session.status === "running" ? "secondary" : "outline"}
                        >
                          {statusLabel(session.status)}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {session.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(session.lastActivityAt)}
                      </span>
                      <Link
                        to={`/agents/${ROCKY_CORE_AGENT_SPEC.id}/sessions/${session.id}`}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-4xl border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted"
                      >
                        <ExternalLink className="size-4" />
                        열기
                      </Link>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="destructive"
                        aria-label={`${session.title ?? session.id} 세션 삭제`}
                        disabled={deleteSessionMutation.isPending}
                        onClick={() =>
                          deleteSessionMutation.mutate({
                            sessionId: session.id,
                            stopRunningRuns: session.status === "running",
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">스킬</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rocky Core 워크스페이스에 배치된 스킬 파일을 관리합니다.
                </p>
              </div>
              <Bot className="size-5 text-muted-foreground" />
            </div>

            <div className="mt-5 grid gap-3">
              {(managementQuery.data?.skills ?? []).map((skill) => (
                <div key={skill.id} className="rounded-lg border bg-background px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {skill.displayName}
                        </span>
                        <Badge variant={skill.synchronized ? "secondary" : "outline"}>
                          {skill.synchronized ? "동기화됨" : "미동기화"}
                        </Badge>
                        {skill.matchedSkillIds.length > 0 ? (
                          <Badge variant={skill.installed ? "secondary" : "outline"}>
                            {skill.installed
                              ? `${skill.installedSkillIds.join(", ")} 설치됨`
                              : `${skill.matchedSkillIds.join(", ")} 미설치`}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {skill.description}
                      </p>
                    </div>
                    {skill.synchronized ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : null}
                  </div>
                  <div className="mt-3 break-all font-mono text-xs text-muted-foreground">
                    {skill.workspacePath ?? "워크스페이스 생성 후 동기화 가능"}
                  </div>
                  {skill.matchedSkillIds.length > 0 ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      연결된 설치 skill:{" "}
                      {skill.installedSkillIds.length > 0
                        ? skill.installedSkillIds.join(", ")
                        : "없음"}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void handleSyncSkills()}
              disabled={syncSkillsMutation.isPending}
            >
              <RefreshCw className="size-4" />
              스킬 동기화
            </Button>
          </section>
        </div>
      </div>
    </section>
  );
}
