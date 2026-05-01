import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight, CircleDashed } from "lucide-react";

import { PageContainer } from "@/shared/components/page-container";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  SKILL_TEMPLATES,
  type SkillField,
  type SkillFieldOption,
  type SkillKind,
  type SkillStep,
} from "../lib/skill-template-catalog";
import { SKILL_KIND_THEME } from "../lib/skill-kind-theme";

function isSkillKind(value: string | undefined): value is SkillKind {
  return (
    value === "document" ||
    value === "content" ||
    value === "data" ||
    value === "translation" ||
    value === "research" ||
    value === "summary" ||
    value === "message"
  );
}

function fieldKindDescription(field: SkillField): string {
  switch (field.kind) {
    case "single-select":
      return "한 가지 선택";
    case "single-select-with-detail":
      return "한 가지 + 세부 선택";
    case "multi-select":
      return "여러 개 선택";
    case "language-pair":
      return "원본 → 번역 언어";
    case "file-upload":
      return "파일 업로드";
    case "file-with-role":
      return "파일 + 역할";
    case "url-or-file":
      return "URL 또는 파일";
    case "text":
      return "직접 입력";
    case "account-connect":
      return "계정 연결 (로그인)";
    case "recipient-address":
      return "받는 곳 입력";
  }
}

export function SkillTemplateDetailPage() {
  const { kind } = useParams<{ kind: string }>();

  if (!isSkillKind(kind)) {
    return <Navigate to="/templates" replace />;
  }

  const template = SKILL_TEMPLATES[kind];
  const theme = SKILL_KIND_THEME[kind];
  const Icon = theme.Icon;

  return (
    <PageContainer>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className={cn("flex size-14 items-center justify-center rounded-2xl", theme.icon)}>
            <Icon className="size-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">
              {template.label}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {template.description}
            </p>
          </div>
        </div>
        <Button render={<Link to={`/skills/new?kind=${template.kind}`} />}>
          이 템플릿으로 스킬 만들기
          <ArrowRight className="size-4" />
        </Button>
      </header>

      <section>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          스킬을 만들 때 묻는 질문 ({template.steps.length}단계)
        </p>
        <ol className="space-y-4">
          {template.steps.map((step, index) => (
            <SkillStepPreview key={step.id} step={step} index={index + 1} />
          ))}
        </ol>
      </section>
    </PageContainer>
  );
}

function SkillStepPreview({ step, index }: { step: SkillStep; index: number }) {
  return (
    <li className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">단계 {index}</span>
        {step.skippable ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <CircleDashed className="size-2.5" />
            선택
          </span>
        ) : null}
      </header>
      <h3 className="mt-1 text-base font-semibold text-foreground">{step.title}</h3>
      {step.helper ? (
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.helper}</p>
      ) : null}

      <div className="mt-5 space-y-5 border-t border-border/60 pt-4">
        {step.fields.map((field) => (
          <SkillFieldPreview key={field.id} field={field} />
        ))}
      </div>
    </li>
  );
}

function SkillFieldPreview({ field }: { field: SkillField }) {
  const metaParts = [
    fieldKindDescription(field),
    field.optional ? "선택" : null,
    field.allowCustom ? "직접 입력 가능" : null,
  ].filter((entry): entry is string => Boolean(entry));

  return (
    <div>
      <p className="text-sm font-medium text-foreground">{field.label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{metaParts.join(" · ")}</p>
      {field.helper ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{field.helper}</p>
      ) : null}

      {field.options && field.options.length > 0 ? (
        <FieldOptionsList options={field.options} />
      ) : null}
    </div>
  );
}

function FieldOptionsList({ options }: { options: SkillFieldOption[] }) {
  const hasNested = options.some(
    (option) => option.detailOptions && option.detailOptions.length > 0,
  );

  if (hasNested) {
    return (
      <ul className="mt-3 space-y-2 text-sm">
        {options.map((option) => (
          <li key={option.id} className="leading-6">
            <span className="text-foreground">· {option.label}</span>
            {option.detailOptions && option.detailOptions.length > 0 ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {option.detailOptions.map((sub) => sub.label).join(" · ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm leading-6 sm:grid-cols-2">
      {options.map((option) => (
        <li key={option.id} className="flex items-start gap-2 text-foreground">
          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
          <span>{option.label}</span>
        </li>
      ))}
    </ul>
  );
}
