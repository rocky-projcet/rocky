import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
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

  async function persistDraft(finalDraft: MdTemplateDraft) {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveTemplate(finalDraft, null);
      toast.success("새 스킬을 만들었습니다.", { description: saved.title });
      navigate("/skills", { replace: true });
    } catch (error) {
      toast.error("스킬을 저장하지 못했습니다.", {
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

      {pendingDraft ? (
        <SkillReviewForm
          draft={pendingDraft}
          saving={saving}
          onBack={() => setPendingDraft(null)}
          onSubmit={(next) => persistDraft(next)}
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
          스킬 만들기
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
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
