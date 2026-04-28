import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileText,
  Home,
  Loader2,
  PenLine,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useMdTemplates } from "@/domains/template/hooks";
import {
  MD_TEMPLATE_WIZARD_STEPS,
  getTemplateCategoryOption,
  templateToDraft,
} from "@/domains/template/lib/md-template-definitions";
import type {
  MdTemplateCategory,
  MdTemplateDefinition,
  MdTemplateDraft,
  MdTemplateSkillSyncStatus,
  MdTemplateWizardStepId,
} from "@/domains/template/types";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Progress } from "@/shared/ui/progress";
import { Textarea } from "@/shared/ui/textarea";
import { agentEngineClient } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/utils";
import type { RockyTemplateInterviewAnswer } from "@/shared/lib/agent-engine-client";

type WizardMessage = {
  id: string;
  role: "rocky" | "user";
  text: string;
};

function TemplateCategoryIcon({ category }: { category: MdTemplateCategory }) {
  if (category === "content") {
    return <PenLine className="size-4" />;
  }

  if (category === "data") {
    return <BarChart3 className="size-4" />;
  }

  return <FileText className="size-4" />;
}

function categoryTone(category: MdTemplateCategory): string {
  if (category === "content") {
    return "border-rose-500/30 bg-rose-500/8 text-rose-700";
  }

  if (category === "data") {
    return "border-sky-500/30 bg-sky-500/8 text-sky-700";
  }

  return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700";
}

function skillStatusLabel(status: MdTemplateSkillSyncStatus): string {
  if (status === "synced") return "실행 준비됨";
  if (status === "syncing") return "저장 중";
  if (status === "failed") return "확인 필요";
  return "로컬 저장";
}

function skillStatusTone(status: MdTemplateSkillSyncStatus): string {
  if (status === "synced") return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700";
  if (status === "syncing") return "border-sky-500/30 bg-sky-500/8 text-sky-700";
  if (status === "failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-border bg-muted text-muted-foreground";
}

function TemplateSummaryCard({
  editHref,
  onDelete,
  template,
}: {
  editHref: string;
  onDelete: (template: MdTemplateDefinition) => void;
  template: MdTemplateDefinition;
}) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("h-6 gap-1 border px-2 text-[11px]", categoryTone(template.category))}
            >
              <TemplateCategoryIcon category={template.category} />
              {template.triggerLabel}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "h-6 gap-1 border px-2 text-[11px]",
                skillStatusTone(template.skill.syncStatus)
              )}
            >
              {template.skill.syncStatus === "syncing" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : template.skill.syncStatus === "failed" ? (
                <AlertTriangle className="size-3" />
              ) : (
                <CheckCircle2 className="size-3" />
              )}
              {skillStatusLabel(template.skill.syncStatus)}
            </Badge>
          </div>
          <h3 className="mt-3 truncate text-base font-semibold text-foreground">
            {template.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {template.description}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase text-muted-foreground">
          실행 전 확인값
        </div>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
          {template.requiredInputs.slice(0, 3).map((input) => (
            <li key={input} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-1 rounded-full bg-border" />
              <span className="line-clamp-1">{input}</span>
            </li>
          ))}
        </ul>
      </div>

      {template.skill.lastSyncError ? (
        <div className="mt-3 line-clamp-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {template.skill.lastSyncError}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {template.outputFormatLabel}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${template.title} 삭제`}
            title="삭제"
            onClick={() => onDelete(template)}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            render={<Link to={editHref} />}
          >
            조정
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function DraftSummary({ draft }: { draft: MdTemplateDraft | null }) {
  const option = getTemplateCategoryOption(draft?.category ?? "document");

  if (!draft) {
    return (
      <aside className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Rocky가 만든 초안</h2>
          <Badge
            variant="outline"
            className="h-6 border-border bg-muted px-2 text-[11px] text-muted-foreground"
          >
            인터뷰 진행 중
          </Badge>
        </div>
        <div className="mt-4 rounded-lg border border-dashed bg-muted/30 px-3 py-5 text-sm leading-6 text-muted-foreground">
          업무 의도, 필요 자료, 결과물, 기준을 모두 답하면 Rocky가 초안을 생성합니다.
        </div>
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">Rocky가 만든 초안</h2>
        <Badge
          variant="outline"
          className={cn("h-6 gap-1 border px-2 text-[11px]", categoryTone(draft.category))}
        >
          <TemplateCategoryIcon category={draft.category} />
          {option.title}
        </Badge>
      </div>

      <dl className="mt-4 space-y-4 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">이름</dt>
          <dd className="mt-1 text-foreground">{draft.title || "아직 정리 중"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">업무</dt>
          <dd className="mt-1 leading-6 text-muted-foreground">
            {draft.description || option.description}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">실행 전 확인값</dt>
          <dd className="mt-2">
            <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
              {(draft.requiredInputs.length > 0
                ? draft.requiredInputs
                : option.requiredInputs
              ).map((input) => (
                <li key={input} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1 rounded-full bg-border" />
                  <span>{input}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">결과물</dt>
          <dd className="mt-1 text-foreground">
            {draft.outputFormatLabel || option.outputFormatLabel}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function wizardMessageId(): string {
  return `wizard.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
}

function rockyPromptForStep(stepId: MdTemplateWizardStepId): string {
  const step = MD_TEMPLATE_WIZARD_STEPS.find((entry) => entry.id === stepId);
  return step ? `${step.prompt}\n${step.helper}` : "";
}

function initialWizardMessages(stepId: MdTemplateWizardStepId): WizardMessage[] {
  return [
    {
      id: wizardMessageId(),
      role: "rocky",
      text: rockyPromptForStep(stepId),
    },
  ];
}

export { SkillTemplateCatalogPage as TemplatesPage } from "@/domains/skill/pages/skill-template-catalog-page";

function _LegacyTemplatesPagePlaceholder() {
  return null;
}

export function TemplateBuilderPage() {
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const { saveTemplate, userTemplates } = useMdTemplates();
  const editingTemplate = useMemo(
    () =>
      templateId
        ? userTemplates.find((template) => template.id === templateId) ?? null
        : null,
    [templateId, userTemplates]
  );
  const editing = Boolean(templateId);
  const [draft, setDraft] = useState<MdTemplateDraft | null>(() =>
    editingTemplate ? templateToDraft(editingTemplate) : null
  );
  const [currentStepId, setCurrentStepId] =
    useState<MdTemplateWizardStepId>(() => (editingTemplate ? "review" : "intent"));
  const [answer, setAnswer] = useState("");
  const [interviewAnswers, setInterviewAnswers] = useState<
    RockyTemplateInterviewAnswer[]
  >([]);
  const [messages, setMessages] = useState<WizardMessage[]>(() =>
    editingTemplate
      ? [
          {
            id: wizardMessageId(),
            role: "rocky",
            text: "저장된 스킬을 불러왔습니다. 아래 초안을 확인하고, 바꾸고 싶은 기준이 있으면 입력창에 적어주세요.",
          },
        ]
      : initialWizardMessages("intent")
  );
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (templateId) {
      if (!editingTemplate) {
        return;
      }

      setDraft(templateToDraft(editingTemplate));
      setInterviewAnswers([]);
      setCurrentStepId("review");
      setAnswer("");
      setMessages([
        {
          id: wizardMessageId(),
          role: "rocky",
          text: "저장된 스킬을 불러왔습니다. 아래 초안을 확인하고, 바꾸고 싶은 기준이 있으면 입력창에 적어주세요.",
        },
      ]);
      return;
    }

    setDraft(null);
    setInterviewAnswers([]);
    setCurrentStepId("intent");
    setAnswer("");
    setMessages(initialWizardMessages("intent"));
  }, [templateId, editingTemplate?.id]);

  const currentStep = useMemo(
    () =>
      MD_TEMPLATE_WIZARD_STEPS.find((step) => step.id === currentStepId) ??
      MD_TEMPLATE_WIZARD_STEPS[0],
    [currentStepId]
  );
  const currentStepIndex = Math.max(
    0,
    MD_TEMPLATE_WIZARD_STEPS.findIndex((step) => step.id === currentStepId)
  );
  const progressValue =
    ((currentStepIndex + 1) / MD_TEMPLATE_WIZARD_STEPS.length) * 100;
  const reviewStep = currentStepId === "review";

  function closeWizard() {
    navigate("/templates");
  }

  function restartWizard() {
    if (editingTemplate) {
      setDraft(templateToDraft(editingTemplate));
      setInterviewAnswers([]);
      setCurrentStepId("review");
      setAnswer("");
      setMessages([
        {
          id: wizardMessageId(),
          role: "rocky",
          text: "저장된 스킬을 다시 불러왔습니다. 수정할 기준을 입력하거나 바로 저장하세요.",
        },
      ]);
      return;
    }

    setDraft(null);
    setInterviewAnswers([]);
    setCurrentStepId("intent");
    setAnswer("");
    setMessages(initialWizardMessages("intent"));
  }

  async function submitWizardAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || saving || processing) {
      return;
    }

    setProcessing(true);
    try {
      const result = await agentEngineClient.processRockyTemplateInterviewTurn({
        stepId: currentStepId,
        answer: trimmed,
        answers: interviewAnswers,
        draft,
      });
      const nextAnswers = reviewStep
        ? interviewAnswers
        : [
            ...interviewAnswers,
            {
              stepId: currentStepId,
              answer: trimmed,
            },
          ];

      if (!reviewStep) {
        setInterviewAnswers(nextAnswers);
      }
      if (result.draft) {
        setDraft(result.draft);
      }
      setCurrentStepId(result.nextStepId);
      setMessages((current) => [
        ...current,
        { id: wizardMessageId(), role: "user", text: trimmed },
        {
          id: wizardMessageId(),
          role: "rocky",
          text:
            result.nextStepId === "review"
              ? `${result.summary}\n오른쪽 초안을 확인한 뒤 저장하세요.`
              : `${result.summary}\n\n${rockyPromptForStep(result.nextStepId)}`,
        },
      ]);
      setAnswer("");
    } catch (error) {
      toast.error("Rocky가 인터뷰 답변을 처리하지 못했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setProcessing(false);
    }
  }

  async function submitTemplate() {
    if (saving || !draft) {
      return;
    }

    setSaving(true);
    try {
      const saved = await saveTemplate(draft, templateId ?? null);
      if (saved.skill.syncStatus === "failed") {
        toast.warning("스킬은 저장했고 실행 기준 연결은 확인이 필요합니다.", {
          description: saved.skill.lastSyncError,
        });
      } else {
        toast.success(editing ? "스킬을 수정했습니다." : "스킬을 저장했습니다.", {
          description: saved.title,
        });
      }
      navigate("/templates", { replace: true });
    } finally {
      setSaving(false);
    }
  }

  if (editing && !editingTemplate) {
    return (
      <PageContainer>
        <PageHeader
          title="스킬을 찾을 수 없습니다."
          description="저장된 스킬이 삭제되었거나 이 브라우저에 남아 있지 않습니다."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={editing ? "스킬 조정" : "새 스킬 만들기"}
        description="업무 의도를 입력하면 Rocky가 실행 목적, 필요 자료, 결과물, 검수 기준을 초안으로 정리합니다."
      />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-lg border bg-card shadow-sm">
          <div className="border-b px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Wand2 className="size-4" />
                  {editing ? "저장된 스킬 조정" : "Rocky 인터뷰"}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {currentStep.title} · {currentStep.helper}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={editing ? "저장본 다시 불러오기" : "처음부터 다시"}
                  title={editing ? "저장본 다시 불러오기" : "처음부터 다시"}
                  onClick={restartWizard}
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="닫기"
                  title="닫기"
                  onClick={closeWizard}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mt-4">
              <Progress value={progressValue} className="h-1.5" />
              <div className="mt-2 grid grid-cols-5 gap-1 text-[11px] text-muted-foreground">
                {MD_TEMPLATE_WIZARD_STEPS.map((step, index) => (
                  <span
                    key={step.id}
                    className={cn(
                      "truncate",
                      index <= currentStepIndex ? "font-medium text-foreground" : ""
                    )}
                  >
                    {step.title}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="custom-scrollbar max-h-[28rem] space-y-4 overflow-y-auto px-4 py-5 md:px-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[min(42rem,88%)] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-6",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>

          <form className="border-t p-4 md:p-5" onSubmit={submitWizardAnswer}>
            <Textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={
                reviewStep
                  ? "바꾸고 싶은 기준을 적거나, 바로 저장하세요."
                  : currentStep.prompt
              }
              className="min-h-24"
            />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {reviewStep ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving || processing}
                  onClick={() => {
                    setCurrentStepId("intent");
                    setDraft(null);
                    setInterviewAnswers([]);
                    setAnswer("");
                    setMessages((current) => [
                      ...current,
                      {
                        id: wizardMessageId(),
                        role: "rocky",
                        text: rockyPromptForStep("intent"),
                      },
                    ]);
                  }}
                >
                  다시 묻기
                </Button>
              ) : null}
              <Button
                type="submit"
                variant="outline"
                disabled={!answer.trim() || saving || processing}
              >
                {processing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {reviewStep ? "수정 반영" : "다음"}
              </Button>
              {reviewStep ? (
                <Button
                  type="button"
                  disabled={saving || processing || !draft}
                  onClick={submitTemplate}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  저장하고 실행 준비
                </Button>
              ) : null}
            </div>
          </form>
        </div>

        <div className="grid gap-4">
          <DraftSummary draft={draft} />
          <div className="rounded-lg border bg-muted/30 p-4">
            <h2 className="text-sm font-semibold text-foreground">저장 후 흐름</h2>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              <li className="rounded-lg bg-background px-3 py-2">
                1. 이 화면에서 만든 초안을 Rocky가 실행할 업무 기준으로 저장합니다.
              </li>
              <li className="rounded-lg bg-background px-3 py-2">
                2. 홈에서 저장한 스킬 카드를 누릅니다.
              </li>
              <li className="rounded-lg bg-background px-3 py-2">
                3. Rocky가 Skill 기준으로 파일, 누락값, 결과물 조건을 확인합니다.
              </li>
            </ol>
          </div>
        </div>
      </section>
    </PageContainer>
  );
}
