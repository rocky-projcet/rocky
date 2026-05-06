import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { useMdTemplates } from "@/domains/template/hooks";
import type { MdTemplateDraft } from "@/domains/template/types";
import type { MdTemplateInputArtifact } from "@/domains/template/types";
import { SKILL_KIND_THEME } from "../lib/skill-kind-theme";
import { SkillTemplateCard } from "../components/skill-template-card";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { SkillWizard, type SkillWizardAnswers } from "../components/skill-wizard";
import { agentEngineClient } from "@/shared/lib/api-client";
import { useAgentsQuery } from "@/domains/agent/hooks";
import { fireMilestone } from "@/domains/onboarding/milestones";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import {
  AGENT_AVATAR_COLORS,
  AGENT_EMOJI_PRESETS,
  useAgentEmoji,
  writeAgentEmoji,
} from "@/domains/agent/lib/agent-avatar-store";
import { useSuggestAgentForSkillMutation } from "@/domains/codex/hooks";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { ensureTemplateSkillDefinition } from "@/domains/template/lib/md-template-definitions";
import { resolveTemplateSkillInstallFiles } from "@/domains/template/lib/runtime-template-files";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type {
  AgentRecord,
  AgentSuggestionRecord,
} from "@/shared/lib/agent-engine-client";
import {
  LANGUAGE_OPTIONS,
  SKILL_TEMPLATES,
  SKILL_TEMPLATE_LIST,
  type SkillKind,
  type SkillTemplate,
} from "../lib/skill-template-catalog";

function parseKind(value: string | null): SkillKind | null {
  if (
    value === "document" ||
    value === "content" ||
    value === "data" ||
    value === "translation" ||
    value === "research" ||
    value === "summary" ||
    value === "message"
  ) {
    return value;
  }
  return null;
}

export function SkillNewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKind = parseKind(searchParams.get("kind"));
  const { saveTemplate } = useMdTemplates();
  const [chosen, setChosen] = useState<SkillTemplate | null>(
    initialKind ? SKILL_TEMPLATES[initialKind] : null,
  );
  const templateRunIdRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<MdTemplateDraft | null>(null);
  const [agentStepDraft, setAgentStepDraft] = useState<MdTemplateDraft | null>(null);

  useEffect(() => {
    const kindParam = parseKind(searchParams.get("kind"));
    if (kindParam) {
      setChosen(SKILL_TEMPLATES[kindParam]);
    }
  }, [searchParams]);

  if (!chosen) {
    return (
      <PageContainer>
        <PageHeader
          title="어떤 스킬을 만드시나요?"
          description="가장 가까운 갈래를 골라주세요. 다음 단계에서 세부 옵션은 선택만 하면 됩니다."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {SKILL_TEMPLATE_LIST.map((template) => (
            <SkillTemplateCard
              key={template.kind}
              template={template}
              footerLabel="시작하기"
              onClick={() => setChosen(template)}
            />
          ))}
        </div>
      </PageContainer>
    );
  }

  function handleSubmit(answers: SkillWizardAnswers) {
    if (!chosen) return;
    const draft = buildDraftFromAnswers(chosen, answers, {
      sourceRunId: templateRunIdRef.current,
    });
    setPendingDraft(draft);
  }

  async function handleUploadFile(input: {
    fieldId: string;
    file: File;
  }): Promise<MdTemplateInputArtifact> {
    if (!chosen) {
      throw new Error("스킬 종류를 먼저 선택해주세요.");
    }

    if (!templateRunIdRef.current) {
      const run = await agentEngineClient.createSkillTemplateRun({
        templateKind: chosen.kind,
      });
      templateRunIdRef.current = run.id;
    }

    return agentEngineClient.uploadSkillTemplateRunFile({
      runId: templateRunIdRef.current,
      fieldId: input.fieldId,
      file: input.file,
    });
  }

  async function persistAndAttach(
    finalDraft: MdTemplateDraft,
    choice:
      | { kind: "skip" }
      | { kind: "existing"; agentId: string }
      | {
          kind: "newAgent";
          input: { name: string; emoji: string; color: string; description: string };
        },
  ): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveTemplate(finalDraft, null);
      const normalized = ensureTemplateSkillDefinition(saved);
      const installFiles = await resolveTemplateSkillInstallFiles(normalized);

      if (choice.kind === "skip") {
        const milestoneFired = fireMilestone("first-skill", {
          title: `첫 스킬 완성! ✨ ${saved.title}`,
          description: "이제 직원에게 장착해서 작업을 보내볼까요?",
        });
        if (!milestoneFired) {
          toast.success("새 스킬을 만들었습니다.", { description: saved.title });
        }
        navigate(`/skills/${encodeURIComponent(saved.id)}`, { replace: true });
        return;
      }

      if (choice.kind === "existing") {
        await agentEngineClient.upsertAgentLocalSkill(
          choice.agentId,
          normalized.skill.id,
          {
            replace: true,
            files: installFiles,
          },
        );
        const milestoneFired = fireMilestone("first-skill", {
          title: `첫 스킬 완성! ✨ ${saved.title}`,
          description: "직원에게 장착했어요. 이제 첫 작업을 보내볼까요?",
        });
        if (!milestoneFired) {
          toast.success("스킬을 만들고 에이전트에 장착했어요.", {
            description: saved.title,
          });
        }
        navigate(
          `/agents/${encodeURIComponent(choice.agentId)}?skill=${encodeURIComponent(saved.id)}`,
          { replace: true },
        );
        return;
      }

      const created = await agentEngineClient.createAgent({
        name: choice.input.name.trim(),
        description: choice.input.description.trim() || null,
      });
      writeAgentEmoji(created.id, choice.input.emoji);
      try {
        await agentEngineClient.updateAgent(created.id, {
          color: choice.input.color,
        });
      } catch {
        /* color update is optional */
      }
      await agentEngineClient.upsertAgentLocalSkill(
        created.id,
        normalized.skill.id,
        {
          replace: true,
          files: installFiles,
        },
      );
      const milestoneFired = fireMilestone("first-skill", {
        title: `첫 스킬 완성! ✨ ${saved.title}`,
        description: `${created.name}에 장착했어요. 이제 첫 작업을 보내볼까요?`,
      });
      if (!milestoneFired) {
        toast.success(`${created.name}이(가) 새로 만들어졌어요.`, {
          description: `${saved.title} 스킬을 장착했어요.`,
        });
      }
      navigate(
        `/agents/${encodeURIComponent(created.id)}?skill=${encodeURIComponent(saved.id)}`,
        { replace: true },
      );
    } catch (error) {
      toast.error("작업을 마무리하지 못했어요.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const chosenTheme = SKILL_KIND_THEME[chosen.kind];
  const ChosenIcon = chosenTheme.Icon;

  return (
    <PageContainer>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", chosenTheme.icon)}>
            <ChosenIcon className="size-5" />
          </div>
          <div>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                chosenTheme.chip,
              )}
            >
              {chosen.label}
            </span>
            <h1 className="mt-1 text-xl font-semibold text-foreground">
              {chosen.label} 스킬 만들기
            </h1>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setChosen(null);
            const next = new URLSearchParams(searchParams);
            next.delete("kind");
            setSearchParams(next, { replace: true });
          }}
        >
          종류 다시 고르기
        </Button>
      </header>

      {agentStepDraft ? (
        <AgentChoiceStep
          draft={agentStepDraft}
          saving={saving}
          onBack={() => setAgentStepDraft(null)}
          onChoose={(choice) => persistAndAttach(agentStepDraft, choice)}
        />
      ) : pendingDraft ? (
        <SkillReviewForm
          draft={pendingDraft}
          saving={saving}
          onBack={() => setPendingDraft(null)}
          onSubmit={(next) => {
            setPendingDraft(null);
            setAgentStepDraft(next);
          }}
        />
      ) : (
        <SkillWizard
          template={chosen}
          onCancel={() => setChosen(null)}
          onSubmit={handleSubmit}
          onUploadFile={handleUploadFile}
          finishLabel="검토하기"
        />
      )}
    </PageContainer>
  );
}

function SkillReviewForm({
  draft,
  saving,
  onBack,
  onSubmit,
}: {
  draft: MdTemplateDraft;
  saving: boolean;
  onBack: () => void;
  onSubmit: (next: MdTemplateDraft) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmedTitle = title.trim() || draft.title;
    const trimmedDescription = description.trim() || draft.description;
    onSubmit({
      ...draft,
      title: trimmedTitle,
      description: trimmedDescription,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
    >
      <div>
        <h2 className="text-2xl font-semibold tracking-normal text-foreground">
          마지막으로, 이 스킬의 이름과 설명을 정리해주세요
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          앞에서 답하신 내용으로 자동 추천한 값이에요. 마음에 들면 그대로 두고, 원하시면 다듬어주세요.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="skill-title" className="text-sm font-medium text-foreground">
          스킬 이름
        </label>
        <Input
          id="skill-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={draft.title}
          className="h-11 text-base"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="skill-description" className="text-sm font-medium text-foreground">
          한 줄 설명
        </label>
        <Textarea
          id="skill-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={draft.description}
          className="min-h-24 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          비우면 자동 추천 값이 사용돼요.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
          <ArrowLeft className="size-4" />
          이전
        </Button>
        <Button type="submit" disabled={saving}>
          다음
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  );
}

function AgentChoiceStep({
  draft,
  saving,
  onBack,
  onChoose,
}: {
  draft: MdTemplateDraft;
  saving: boolean;
  onBack: () => void;
  onChoose: (
    choice:
      | { kind: "skip" }
      | { kind: "existing"; agentId: string }
      | {
          kind: "newAgent";
          input: { name: string; emoji: string; color: string; description: string };
        },
  ) => void;
}) {
  const agentsQuery = useAgentsQuery({ includeArchived: false });
  const agents = filterUserManagedAgents(agentsQuery.data ?? []);
  const suggestMutation = useSuggestAgentForSkillMutation();
  const [suggestion, setSuggestion] = useState<AgentSuggestionRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    suggestMutation
      .mutateAsync({
        title: draft.title,
        description: draft.description,
        triggerLabel: draft.triggerLabel,
      })
      .then((next) => setSuggestion(next))
      .catch(() => {
        // best-effort; user can still pick existing or skip
      });
  }, [draft, suggestMutation]);

  const suggestionLoading = suggestMutation.isPending && !suggestion;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-normal text-foreground">
          이 스킬을 누가 쓸까요?
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          에이전트를 골라두면 만들자마자 바로 작업을 시작할 수 있어요.
        </p>
      </div>

      <ul data-tour="agent-step-grid" className="grid gap-2 sm:grid-cols-2">
        {agents.map((agent) => (
          <li key={agent.id}>
            <ExistingAgentCard
              agent={agent}
              disabled={saving}
              onSelect={() => onChoose({ kind: "existing", agentId: agent.id })}
            />
          </li>
        ))}
        <li>
          <NewAgentCard
            disabled={saving}
            suggestion={suggestion}
            suggestionLoading={suggestionLoading}
            onSelect={() => setCreateOpen(true)}
          />
        </li>
      </ul>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
          <ArrowLeft className="size-4" />
          이전
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChoose({ kind: "skip" })}
          disabled={saving}
        >
          나중에 정할게요
        </Button>
      </div>

      <QuickCreateAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        suggestion={suggestion}
        saving={saving}
        onSubmit={(input) => onChoose({ kind: "newAgent", input })}
      />
    </div>
  );
}

function ExistingAgentCard({
  agent,
  disabled,
  onSelect,
}: {
  agent: AgentRecord;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { emoji } = useAgentEmoji(agent.id);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left transition",
        "hover:border-foreground/40 hover:bg-muted/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <AgentAvatar emoji={emoji} color={agent.color} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
        {agent.description ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {agent.description}
          </p>
        ) : (
          <p className="truncate text-[11px] text-muted-foreground">장착해서 사용</p>
        )}
      </div>
      <ArrowRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function NewAgentCard({
  disabled,
  suggestion,
  suggestionLoading,
  onSelect,
}: {
  disabled: boolean;
  suggestion: AgentSuggestionRecord | null;
  suggestionLoading: boolean;
  onSelect: () => void;
}) {
  const previewName = suggestion?.name ?? null;
  const previewEmoji = suggestion?.emoji ?? "✨";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-border/80 bg-muted/20 px-3 py-2.5 text-left transition",
        "hover:border-foreground/40 hover:bg-muted/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-2xl bg-background text-lg">
        {suggestionLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          previewEmoji
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          에이전트 새로 만들기
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {suggestionLoading
            ? "추천을 가져오는 중…"
            : previewName
              ? `추천: ${previewName}`
              : "이름과 색상을 정해주세요"}
        </p>
      </div>
      <Plus className="size-4 text-muted-foreground" />
    </button>
  );
}

function QuickCreateAgentDialog({
  open,
  onOpenChange,
  suggestion,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  suggestion: AgentSuggestionRecord | null;
  saving: boolean;
  onSubmit: (input: {
    name: string;
    emoji: string;
    color: string;
    description: string;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string>(AGENT_EMOJI_PRESETS[0]);
  const [color, setColor] = useState<string>(AGENT_AVATAR_COLORS[0]);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(suggestion?.name ?? "");
    setDescription(suggestion?.description ?? "");
    setEmoji(
      suggestion?.emoji && AGENT_EMOJI_PRESETS.includes(suggestion.emoji)
        ? suggestion.emoji
        : suggestion?.emoji ?? AGENT_EMOJI_PRESETS[0],
    );
    setColor(AGENT_AVATAR_COLORS[0]);
  }, [open, suggestion]);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !saving;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: trimmedName, emoji, color, description: description.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>에이전트 새로 만들기</DialogTitle>
          <DialogDescription>
            이 스킬을 곧바로 장착할 새 에이전트를 만듭니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3">
            <AgentAvatar emoji={emoji} color={color} size="xl" />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="에이전트 이름"
              className="h-11 max-w-xs text-center text-base"
              aria-label="에이전트 이름"
              autoFocus
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">이모지</p>
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-11">
              {AGENT_EMOJI_PRESETS.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setEmoji(option)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-xl border text-lg leading-none transition",
                    option === emoji
                      ? "border-foreground bg-muted"
                      : "border-transparent bg-background hover:border-border hover:bg-muted/60",
                  )}
                  aria-label={`이모지 ${option}`}
                >
                  <span className="block translate-y-px">{option}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">배경색</p>
            <div className="grid grid-cols-8 gap-2 sm:grid-cols-16">
              {AGENT_AVATAR_COLORS.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setColor(option)}
                  className={cn(
                    "aspect-square rounded-full border-2 transition",
                    option === color
                      ? "border-foreground"
                      : "border-transparent hover:scale-110",
                  )}
                  style={{ backgroundColor: option }}
                  aria-label={`색상 ${option}`}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="flex flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function languageLabel(id: string): string {
  return LANGUAGE_OPTIONS.find((entry) => entry.id === id)?.label ?? id;
}

function lookupOptionLabel(template: SkillTemplate, fieldId: string, optionId: string): string {
  for (const step of template.steps) {
    for (const field of step.fields) {
      if (field.id !== fieldId) continue;
      const direct = field.options?.find((opt) => opt.id === optionId);
      if (direct) return direct.label;
      for (const option of field.options ?? []) {
        const detail = option.detailOptions?.find((opt) => opt.id === optionId);
        if (detail) return detail.label;
      }
    }
  }
  return optionId;
}

function isInputArtifact(value: unknown): value is MdTemplateInputArtifact {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as MdTemplateInputArtifact).fileName === "string" &&
    typeof (value as MdTemplateInputArtifact).runtimePath === "string"
  );
}

function artifactLabel(value: MdTemplateInputArtifact & { role?: string }): string {
  return value.role ? `${value.fileName} (${value.role})` : value.fileName;
}

function describeAnswer(template: SkillTemplate, fieldId: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    if (value.startsWith("custom:")) return value.slice("custom:".length);
    return lookupOptionLabel(template, fieldId, value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (typeof value[0] === "string") {
      return (value as string[])
        .map((entry) =>
          entry.startsWith("custom:")
            ? entry.slice("custom:".length)
            : lookupOptionLabel(template, fieldId, entry),
        )
        .join(", ");
    }
    return (value as Array<MdTemplateInputArtifact & { role?: string }>)
      .map(artifactLabel)
      .join(", ");
  }
  if (isInputArtifact(value)) {
    return value.fileName;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("from" in obj && "to" in obj) {
      return `${languageLabel(String(obj.from))} → ${languageLabel(String(obj.to))}`;
    }
    if ("primary" in obj) {
      const primary = String(obj.primary ?? "");
      const detail = obj.detail ? String(obj.detail) : "";
      const custom = obj.custom ? String(obj.custom) : "";
      if (primary === "__custom") return custom || "직접 입력";
      const label = lookupOptionLabel(template, fieldId, primary);
      return detail ? `${label} · ${lookupOptionLabel(template, fieldId, detail)}` : label;
    }
  }
  return String(value);
}

function pickTitle(template: SkillTemplate, answers: SkillWizardAnswers): string {
  if (template.kind === "document") {
    const docType = answers["documentType"];
    return `${describeAnswer(template, "documentType", docType)} 자동화`;
  }
  if (template.kind === "content") {
    const channel = answers["channel"];
    return `${describeAnswer(template, "channel", channel)} 콘텐츠`;
  }
  if (template.kind === "data") {
    const kind = answers["analysisKind"];
    return `${describeAnswer(template, "analysisKind", kind)}`;
  }
  if (template.kind === "translation") {
    const pair = answers["languagePair"];
    return `${describeAnswer(template, "languagePair", pair)} 번역`;
  }
  if (template.kind === "research") {
    const subject = answers["researchSubject"];
    return `${describeAnswer(template, "researchSubject", subject)} 리서치`;
  }
  if (template.kind === "summary") {
    const sourceKind = answers["sourceKind"];
    return `${describeAnswer(template, "sourceKind", sourceKind)} 요약`;
  }
  if (template.kind === "message") {
    const channel = answers["channel"];
    return `${describeAnswer(template, "channel", channel)} 작성`;
  }
  return "새 스킬";
}

function pickTriggerLabel(template: SkillTemplate): string {
  switch (template.kind) {
    case "document":
      return "문서 자동화";
    case "content":
      return "콘텐츠 제작";
    case "data":
      return "데이터 분석";
    case "translation":
      return "번역";
    case "research":
      return "리서치";
    case "summary":
      return "요약 정리";
    case "message":
      return "메시지·이메일 작성";
  }
}

function pickOutputFormatLabel(template: SkillTemplate, answers: SkillWizardAnswers): string {
  const formats = answers["outputFormats"];
  if (Array.isArray(formats) && formats.length > 0) {
    return (formats as string[])
      .map((id) => lookupOptionLabel(template, "outputFormats", id))
      .join(" / ");
  }
  if (template.kind === "translation") {
    const sourceKind = answers["sourceKind"];
    return typeof sourceKind === "string"
      ? lookupOptionLabel(template, "sourceKind", sourceKind)
      : "텍스트";
  }
  return "자유 형식";
}

function pickRequiredInputs(template: SkillTemplate, answers: SkillWizardAnswers): string[] {
  const inputs: string[] = [];
  for (const step of template.steps) {
    for (const field of step.fields) {
      const raw = answers[field.id];
      if (raw == null) continue;
      if (field.kind === "file-upload") {
        const label = isInputArtifact(raw)
          ? raw.fileName
          : typeof raw === "string"
            ? raw
            : "";
        if (label) {
          inputs.push(`${field.label}: ${label}`);
        }
      }
      if (field.kind === "file-with-role" && Array.isArray(raw)) {
        for (const entry of raw as Array<MdTemplateInputArtifact & { role?: string }>) {
          inputs.push(entry.role ? `${entry.role}: ${entry.fileName}` : entry.fileName);
        }
      }
      if (field.kind === "url-or-file") {
        const label = isInputArtifact(raw)
          ? raw.fileName
          : typeof raw === "string"
            ? raw
            : "";
        if (label) {
          inputs.push(`${field.label}: ${label}`);
        }
      }
    }
  }
  return inputs;
}

function collectInputArtifacts(answers: SkillWizardAnswers): MdTemplateInputArtifact[] {
  const artifacts: MdTemplateInputArtifact[] = [];
  for (const value of Object.values(answers)) {
    if (isInputArtifact(value)) {
      artifacts.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isInputArtifact(entry)) {
          artifacts.push(entry);
        }
      }
    }
  }
  return artifacts;
}

function pickInstructions(template: SkillTemplate, answers: SkillWizardAnswers): string {
  const lines: string[] = [];
  lines.push(`목적: ${pickTitle(template, answers)}`);
  for (const step of template.steps) {
    for (const field of step.fields) {
      if (
        field.kind === "file-upload" ||
        field.kind === "file-with-role" ||
        field.kind === "url-or-file"
      ) {
        continue;
      }
      const raw = answers[field.id];
      if (raw == null) continue;
      const text = describeAnswer(template, field.id, raw);
      if (!text || text === "—") continue;
      lines.push(`- ${field.label}: ${text}`);
    }
  }
  return lines.join("\n");
}

function buildDraftFromAnswers(
  template: SkillTemplate,
  answers: SkillWizardAnswers,
  options: {
    sourceRunId?: string | null;
  } = {},
): MdTemplateDraft {
  const title = pickTitle(template, answers);
  const triggerLabel = pickTriggerLabel(template);
  const description = `${template.description} (${title})`;
  const outputFormatLabel = pickOutputFormatLabel(template, answers);
  const requiredInputs = pickRequiredInputs(template, answers);
  const defaultInstructions = pickInstructions(template, answers);
  const inputArtifacts = collectInputArtifacts(answers);

  return {
    category: template.fallbackCategory,
    title,
    description,
    triggerLabel,
    requiredInputs,
    inputFiles: inputArtifacts.map((artifact) => artifact.fileName),
    inputArtifacts,
    sourceRunId: options.sourceRunId ?? inputArtifacts[0]?.runId ?? null,
    outputFormatLabel,
    defaultInstructions,
  };
}
