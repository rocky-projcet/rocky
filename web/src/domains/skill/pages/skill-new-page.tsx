import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { useMdTemplates } from "@/domains/template/hooks";
import {
  requiredInputsFromText,
  requiredInputsToText,
  templateToDraft,
} from "@/domains/template/lib/md-template-definitions";
import type { MdTemplateDraft } from "@/domains/template/types";
import type { MdTemplateInputArtifact } from "@/domains/template/types";
import { inferSkillKind, SKILL_KIND_THEME } from "../lib/skill-kind-theme";
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
import { useMiniTour } from "@/domains/onboarding/use-mini-tour";
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
  type SkillField,
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
    value === "message" ||
    value === "erp"
  ) {
    return value;
  }
  return null;
}

function templateWizardAnswerKey(template: {
  id: string;
  updatedAt?: string;
  defaultInstructions: string;
}): string {
  return `${template.id}:${template.updatedAt ?? ""}:${template.defaultInstructions}`;
}

export function SkillNewPage() {
  const navigate = useNavigate();
  const { skillId } = useParams<{ skillId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKind = parseKind(searchParams.get("kind"));
  const editing = Boolean(skillId);
  const { saveTemplate, userTemplates, templatesLoaded } = useMdTemplates();
  const editingTemplate = useMemo(
    () => (skillId ? userTemplates.find((template) => template.id === skillId) ?? null : null),
    [skillId, userTemplates],
  );
  const editingTemplateKey = editingTemplate ? templateWizardAnswerKey(editingTemplate) : null;
  const editingKind = editingTemplate ? inferSkillKind(editingTemplate) : null;
  const [chosen, setChosen] = useState<SkillTemplate | null>(
    editingKind
      ? SKILL_TEMPLATES[editingKind]
      : initialKind
        ? SKILL_TEMPLATES[initialKind]
        : null,
  );
  const templateRunIdRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wizardAnswers, setWizardAnswers] = useState<SkillWizardAnswers | null>(null);
  const [wizardAnswersSourceKey, setWizardAnswersSourceKey] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<MdTemplateDraft | null>(null);
  const [agentStepDraft, setAgentStepDraft] = useState<MdTemplateDraft | null>(null);

  const inWizard =
    chosen !== null && pendingDraft === null && agentStepDraft === null;
  useMiniTour({
    key: "skill-wizard",
    enabled: !editing && inWizard && userTemplates.length === 0,
    spotlight: {
      element: '[data-tour="skill-wizard-step"]',
      side: "left",
      align: "start",
      title: "위저드 따라오시면 자동으로 정리돼요",
      description:
        "각 단계에서 가장 가까운 답을 고르면 충분해요. 마지막에 이름·설명을 다듬고 직원에 장착해서 작업까지 한 번에 이어집니다.",
    },
  });

  useEffect(() => {
    if (editing) return;
    const kindParam = parseKind(searchParams.get("kind"));
    if (kindParam) {
      setChosen(SKILL_TEMPLATES[kindParam]);
    }
  }, [editing, searchParams]);

  useEffect(() => {
    if (!editing || !editingTemplate) return;
    const kind = inferSkillKind(editingTemplate);
    const template = SKILL_TEMPLATES[kind];
    setChosen(template);
    setWizardAnswers(draftToWizardAnswers(template, templateToDraft(editingTemplate)));
    setWizardAnswersSourceKey(templateWizardAnswerKey(editingTemplate));
    setPendingDraft(null);
    setAgentStepDraft(null);
    templateRunIdRef.current = editingTemplate.sourceRunId ?? null;
  }, [editing, editingTemplate]);

  if (editing && !templatesLoaded) {
    return (
      <PageContainer>
        <PageHeader
          title="스킬을 불러오는 중입니다."
          description="저장된 스킬 정보를 확인하고 있어요."
        />
      </PageContainer>
    );
  }

  if (editing && !editingTemplate) {
    return (
      <PageContainer>
        <PageHeader
          title="스킬을 찾을 수 없습니다."
          description="삭제되었거나 이 브라우저에 저장된 스킬이 아닙니다."
        />
      </PageContainer>
    );
  }

  if (
    editing &&
    (!wizardAnswers || wizardAnswersSourceKey !== editingTemplateKey)
  ) {
    return (
      <PageContainer>
        <PageHeader
          title="스킬을 불러오는 중입니다."
          description="편집 화면에 기존 설정을 채우고 있어요."
        />
      </PageContainer>
    );
  }

  if (!chosen) {
    return (
      <PageContainer>
        <PageHeader
          title="어떤 공용 스킬을 만드시나요?"
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
    setWizardAnswers(answers);
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

  async function persistDraft(finalDraft: MdTemplateDraft): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveTemplate(finalDraft, skillId ?? null);
      toast.success(editing ? "스킬을 수정했습니다." : "새 스킬을 만들었습니다.", {
        description: saved.title,
      });
      navigate(editing ? `/skills/${encodeURIComponent(saved.id)}` : "/skills", {
        replace: true,
      });
    } catch (error) {
      toast.error(editing ? "스킬을 수정하지 못했습니다." : "스킬을 저장하지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
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
      <header className="flex flex-wrap items-center justify-between gap-3 pt-10">
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
              {chosen.label} 스킬 {editing ? "수정" : "만들기"}
            </h1>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (editing && skillId) {
              navigate(`/skills/${encodeURIComponent(skillId)}`);
              return;
            }
            setChosen(null);
            const next = new URLSearchParams(searchParams);
            next.delete("kind");
            setSearchParams(next, { replace: true });
          }}
        >
          {editing ? "상세로 돌아가기" : "종류 다시 고르기"}
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
            if (editing) {
              void persistDraft(next);
              return;
            }
            setPendingDraft(null);
            setAgentStepDraft(next);
          }}
          submitLabel={editing ? "수정 저장" : undefined}
        />
      ) : (
        <div data-tour="skill-wizard-step">
          <SkillWizard
            template={chosen}
            initialAnswers={wizardAnswers ?? undefined}
            onCancel={() => {
              if (editing && skillId) {
                navigate(`/skills/${encodeURIComponent(skillId)}`);
                return;
              }
              setChosen(null);
            }}
            onSubmit={handleSubmit}
            onUploadFile={handleUploadFile}
            finishLabel="검토하기"
          />
        </div>
      )}
    </PageContainer>
  );
}

function SkillReviewForm({
  draft,
  saving,
  onBack,
  onSubmit,
  submitLabel = "다음",
}: {
  draft: MdTemplateDraft;
  saving: boolean;
  onBack: () => void;
  onSubmit: (next: MdTemplateDraft) => void;
  submitLabel?: string;
}) {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [triggerLabel, setTriggerLabel] = useState(draft.triggerLabel);
  const [outputFormatLabel, setOutputFormatLabel] = useState(draft.outputFormatLabel);
  const [requiredInputsText, setRequiredInputsText] = useState(
    requiredInputsToText(draft.requiredInputs),
  );
  const [defaultInstructions, setDefaultInstructions] = useState(
    draft.defaultInstructions,
  );

  useEffect(() => {
    setTitle(draft.title);
    setDescription(draft.description);
    setTriggerLabel(draft.triggerLabel);
    setOutputFormatLabel(draft.outputFormatLabel);
    setRequiredInputsText(requiredInputsToText(draft.requiredInputs));
    setDefaultInstructions(draft.defaultInstructions);
  }, [draft]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmedTitle = title.trim() || draft.title;
    const trimmedDescription = description.trim() || draft.description;
    onSubmit({
      ...draft,
      title: trimmedTitle,
      description: trimmedDescription,
      triggerLabel: triggerLabel.trim() || draft.triggerLabel,
      outputFormatLabel: outputFormatLabel.trim() || draft.outputFormatLabel,
      requiredInputs: requiredInputsFromText(requiredInputsText),
      defaultInstructions: defaultInstructions.trim() || draft.defaultInstructions,
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
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
          <label htmlFor="skill-trigger-label" className="text-sm font-medium text-foreground">
            분류 라벨
          </label>
          <Input
            id="skill-trigger-label"
            value={triggerLabel}
            onChange={(event) => setTriggerLabel(event.target.value)}
            placeholder={draft.triggerLabel}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="skill-output-format" className="text-sm font-medium text-foreground">
            결과 형식
          </label>
          <Input
            id="skill-output-format"
            value={outputFormatLabel}
            onChange={(event) => setOutputFormatLabel(event.target.value)}
            placeholder={draft.outputFormatLabel}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
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
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label htmlFor="skill-required-inputs" className="text-sm font-medium text-foreground">
            필요한 입력
          </label>
          <Textarea
            id="skill-required-inputs"
            value={requiredInputsText}
            onChange={(event) => setRequiredInputsText(event.target.value)}
            placeholder="한 줄에 하나씩 입력"
            className="min-h-24 text-sm"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label htmlFor="skill-default-instructions" className="text-sm font-medium text-foreground">
            기본 지시문
          </label>
          <Textarea
            id="skill-default-instructions"
            value={defaultInstructions}
            onChange={(event) => setDefaultInstructions(event.target.value)}
            placeholder={draft.defaultInstructions}
            className="min-h-44 font-mono text-xs leading-5"
          />
          <p className="text-xs text-muted-foreground">
            비우면 자동 추천 값이 사용돼요.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
          <ArrowLeft className="size-4" />
          이전
        </Button>
        <Button type="submit" disabled={saving}>
          {submitLabel}
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
          이 공용 스킬의 사본을 누구에게 줄까요?
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          공용본은 그대로 보관하고, 사본을 받은 직원이 안에서 따로 진화시킵니다. 지금 정해두면 바로 작업을 시작할 수 있어요.
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

function draftToWizardAnswers(
  template: SkillTemplate,
  draft: MdTemplateDraft,
): SkillWizardAnswers {
  const instructionAnswers = parseInstructionAnswers(draft.defaultInstructions);
  const answers: SkillWizardAnswers = {};

  for (const step of template.steps) {
    for (const field of step.fields) {
      const artifactAnswer = answerFromArtifacts(field, draft);
      if (artifactAnswer != null) {
        answers[field.id] = artifactAnswer;
        continue;
      }

      const rawText =
        findInstructionAnswer(instructionAnswers, field) ??
        findRequiredInputAnswer(draft, field) ??
        (field.id === "outputFormats" ? draft.outputFormatLabel : null);
      if (!rawText) continue;

      const answer = answerFromText(field, rawText);
      if (answer != null) {
        answers[field.id] = answer;
      }
    }
  }

  return answers;
}

function parseInstructionAnswers(defaultInstructions: string): Map<string, string> {
  const answers = new Map<string, string>();
  for (const line of defaultInstructions.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;
    const body = trimmed.slice(2);
    const separatorIndex = body.indexOf(":");
    if (separatorIndex <= 0) continue;
    const label = body.slice(0, separatorIndex).trim();
    const value = body.slice(separatorIndex + 1).trim();
    if (label && value) {
      answers.set(label, value);
    }
  }
  return answers;
}

function findInstructionAnswer(
  instructionAnswers: Map<string, string>,
  field: SkillField,
): string | null {
  const direct = instructionAnswers.get(field.label);
  if (direct) return direct;
  if (field.kind === "erp-integration-select") {
    return (
      instructionAnswers.get("ERP 연동") ??
      instructionAnswers.get("이카운트 연결 테스트") ??
      null
    );
  }
  return null;
}

function findRequiredInputAnswer(
  draft: MdTemplateDraft,
  field: SkillField,
): string | null {
  const prefix = `${field.label}:`;
  const entry = draft.requiredInputs.find((input) => input.startsWith(prefix));
  return entry ? entry.slice(prefix.length).trim() : null;
}

function answerFromArtifacts(
  field: SkillField,
  draft: MdTemplateDraft,
): SkillWizardAnswers[string] | null {
  const artifacts = draft.inputArtifacts?.filter((artifact) => artifact.fieldId === field.id) ?? [];
  if (field.kind === "file-with-role") {
    return artifacts.length > 0 ? artifacts : null;
  }
  if (
    field.kind === "file-upload" ||
    field.kind === "url-or-file"
  ) {
    return artifacts[0] ?? null;
  }
  return null;
}

function answerFromText(
  field: SkillField,
  rawText: string,
): SkillWizardAnswers[string] | null {
  const text = rawText.trim();
  if (!text) return null;

  switch (field.kind) {
    case "single-select":
      return answerSingleSelect(field, text);
    case "single-select-with-detail":
      return answerSingleSelectWithDetail(field, text);
    case "multi-select":
      return answerMultiSelect(field, text);
    case "language-pair":
      return answerLanguagePair(text);
    case "text":
    case "account-connect":
    case "recipient-address":
    case "file-upload":
    case "url-or-file":
      return text;
    case "erp-integration-select":
      return answerErpIntegration(text);
    default:
      return null;
  }
}

function answerSingleSelect(field: SkillField, text: string): SkillWizardAnswers[string] | null {
  if (field.id === "dataSource") {
    if (text === "이카운트 ERP" || text === "ERP") return "erp";
    if (text === "파일 + 이카운트 ERP" || text === "파일 + ERP") return "file-and-erp";
  }
  const option = field.options?.find((entry) => entry.label === text);
  if (option && !option.disabled) return option.id;
  return field.allowCustom ? { primary: "__custom", custom: text } : null;
}

function answerErpIntegration(text: string): SkillWizardAnswers[string] | null {
  if (text.includes("이카운트") || text.toLowerCase().includes("ecount")) {
    return "ecount";
  }
  return null;
}

function answerSingleSelectWithDetail(
  field: SkillField,
  text: string,
): SkillWizardAnswers[string] | null {
  const [primaryText, detailText] = text.split("·").map((entry) => entry.trim());
  const primary = field.options?.find((entry) => entry.label === primaryText);
  if (primary && !primary.disabled) {
    const detail = primary.detailOptions?.find(
      (entry) => entry.label === detailText && !entry.disabled,
    );
    return detail ? { primary: primary.id, detail: detail.id } : { primary: primary.id };
  }
  return field.allowCustom ? { primary: "__custom", custom: text } : null;
}

function answerMultiSelect(field: SkillField, text: string): SkillWizardAnswers[string] | null {
  const values = text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const option = field.options?.find((candidate) => candidate.label === entry);
      if (option && !option.disabled) return option.id;
      return field.allowCustom ? `custom:${entry}` : null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return values.length > 0 ? values : null;
}

function answerLanguagePair(text: string): SkillWizardAnswers[string] | null {
  const [fromText, toText] = text.split("→").map((entry) => entry.trim());
  const from = LANGUAGE_OPTIONS.find((entry) => entry.label === fromText)?.id;
  const to = LANGUAGE_OPTIONS.find((entry) => entry.label === toText)?.id;
  return from && to ? { from, to } : null;
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

function usesErpDataSource(value: unknown): boolean {
  return (
    value === "erp" ||
    value === "file-and-erp" ||
    value === "ecount-erp" ||
    value === "file-and-ecount"
  );
}

function usesEcountIntegration(answers: SkillWizardAnswers): boolean {
  const source = answers["dataSource"];
  return (
    (usesErpDataSource(source) && answers["erpIntegration"] === "ecount") ||
    source === "ecount-erp" ||
    source === "file-and-ecount"
  );
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
    const label = describeAnswer(template, "analysisKind", kind);
    return usesEcountIntegration(answers)
      ? `이카운트 ERP ${label}`
      : label;
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
  if (template.kind === "erp") {
    const system = answers["erpSystem"];
    const action = answers["action"];
    const systemLabel = describeAnswer(template, "erpSystem", system);
    const actionLabel = describeAnswer(template, "action", action);
    return `${systemLabel} ${actionLabel}`.trim() || "ERP 연동";
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
    case "erp":
      return "ERP 연동";
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
  if (template.kind === "data" && usesEcountIntegration(answers)) {
    inputs.push("연결된 이카운트 ERP 연동");
    inputs.push("조회할 이카운트 ERP 메뉴와 데이터 범위");
    inputs.push("조회 기간, 창고, 거래처, 품목 등 필터 기준");
    inputs.push("ERP 등록·수정 요청은 실행하지 않고 제공 예정으로 안내");
  }
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
  return [...new Set(inputs)];
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
        template.kind === "data" &&
        field.id.startsWith("ecount") &&
        !usesEcountIntegration(answers)
      ) {
        continue;
      }
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
  if (template.kind === "data" && usesEcountIntegration(answers)) {
    lines.push("- 이카운트 연동은 현재 조회와 분석만 허용합니다.");
    lines.push("- 이카운트 API 키, 비밀번호, 회사 인증 정보는 사용자 답변이나 스킬 본문에 평문으로 저장하지 않습니다.");
    lines.push("- 품목·거래처·주문·전표 등록, 수정, 삭제, 전송은 실행하지 않습니다. 사용자가 요청하면 제공 예정이라고 안내합니다.");
    lines.push("- 조회 결과와 업로드 파일을 대조할 때 품목코드, 거래처코드, 창고, 기간 기준을 먼저 확인합니다.");
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
