import { useEffect, useMemo, useState } from "react";
import {
  Save,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";

import { useRuntimesQuery } from "@/domains/codex/hooks";
import {
  useRockyCoreManagementQuery,
  useUpdateRockyCoreSettingsMutation,
} from "@/domains/rocky/hooks";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
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
