import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  PlayCircle,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { useRuntimesQuery } from "@/domains/codex/hooks";
import {
  useCheckRockyAppUpdateMutation,
  useDownloadRockyAppUpdateMutation,
  useRockyAppUpdateQuery,
  useRockyCoreManagementQuery,
  useStartRockyAppUpdateInstallerMutation,
  useUpdateRockyCoreSettingsMutation,
} from "@/domains/rocky/hooks";
import {
  appUpdateStatusLabel,
  canInstallAppUpdate,
  primaryAppUpdateActionLabel,
} from "@/domains/rocky/lib/app-update";
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

function AppUpdatePanel() {
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
    <section className="rounded-lg border bg-card p-5">
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
        description="설치 프로그램 실행 후 Rocky가 재시작될 수 있으며 진행 중인 작업이 중단될 수 있습니다. .runtime, .codex, .tools, .env 파일은 보존 대상입니다."
        confirmLabel="설치 실행"
        cancelLabel="취소"
        pending={installMutation.isPending}
        onConfirm={() => void handleInstallConfirm()}
      />
    </section>
  );
}

export function RockyAgentPage() {
  const managementQuery = useRockyCoreManagementQuery();
  const runtimesQuery = useRuntimesQuery();
  const updateSettingsMutation = useUpdateRockyCoreSettingsMutation();

  const settings = managementQuery.data?.settings;

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

  if (managementQuery.isLoading) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
        <h3 className="text-lg font-semibold text-foreground">Rocky Core 상태 준비 중</h3>
      </Card>
    );
  }

  if (managementQuery.isError) {
    const error =
      (managementQuery.error instanceof Error && managementQuery.error.message) ||
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

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4">
          <AppUpdatePanel />

          <section className="rounded-lg border bg-card p-5">
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
        </div>
      </div>
    </section>
  );
}
