import { Link } from "react-router-dom";
import { Archive, FileBox, Paperclip, Plus } from "lucide-react";

import { useMdTemplates } from "@/domains/template/hooks";
import type { MdTemplateDefinition } from "@/domains/template/types";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { skillKindTheme } from "../lib/skill-kind-theme";

export function SkillsPage() {
  const { activeTemplates: userTemplates } = useMdTemplates();

  return (
    <PageContainer>
      <PageHeader
        title="스킬"
        description="템플릿에서 만든 내 스킬 목록입니다. 카드에서 바로 실행할 수 있어요."
        actions={
          <>
            <Button variant="outline" render={<Link to="/skills/archived" />}>
              <Archive className="size-4" />
              보관함
            </Button>
            <Button render={<Link to="/skills/new" />}>
              <Plus className="size-4" />
              새 스킬 만들기
            </Button>
          </>
        }
      />

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li>
          <NewSkillCard />
        </li>
        {userTemplates.map((template) => (
          <li key={template.id}>
            <SkillSummaryCard template={template} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

function NewSkillCard() {
  return (
    <Link
      to="/skills/new"
      className="group flex h-full min-h-[180px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/70 bg-muted/30 p-4 text-center no-underline transition hover:border-primary/50 hover:bg-muted/60"
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-background text-muted-foreground transition group-hover:text-primary">
        <Plus className="size-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">새 스킬 만들기</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        4단계 질문에 답하면 새 스킬이 만들어져요.
      </p>
    </Link>
  );
}

function SkillSummaryCard({ template }: { template: MdTemplateDefinition }) {
  const theme = skillKindTheme(template);
  const Icon = theme.Icon;
  const fileCount = template.requiredInputs.length;
  const firstFile = template.requiredInputs[0];
  const outputFormat = template.outputFormatLabel || "자유 형식";

  return (
    <Link
      to={`/skills/${encodeURIComponent(template.id)}`}
      className="group flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex size-10 items-center justify-center rounded-xl", theme.icon)}>
          <Icon className="size-5" />
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
            theme.chip,
          )}
        >
          {template.triggerLabel}
        </span>
      </div>

      <div className="mt-3 min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{template.title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {template.description}
        </p>
      </div>

      <dl className="mt-3 grid gap-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <FileBox className="size-3.5 text-muted-foreground" />
          <dt className="text-[10px] uppercase tracking-wide">결과</dt>
          <dd className="ml-auto truncate text-foreground" title={outputFormat}>
            {outputFormat}
          </dd>
        </div>
        {fileCount > 0 ? (
          <div className="flex items-center gap-1.5">
            <Paperclip className="size-3.5 text-muted-foreground" />
            <dt className="text-[10px] uppercase tracking-wide">파일</dt>
            <dd className="ml-auto truncate text-foreground" title={template.requiredInputs.join(", ")}>
              {fileCount === 1 ? firstFile : `${firstFile} 외 ${fileCount - 1}개`}
            </dd>
          </div>
        ) : null}
      </dl>
    </Link>
  );
}
