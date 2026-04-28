import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { SKILL_KIND_THEME } from "../lib/skill-kind-theme";
import type { SkillTemplate } from "../lib/skill-template-catalog";

interface SkillTemplateCardProps {
  template: SkillTemplate;
  footerLabel: string;
  href?: string;
  onClick?: () => void;
  /** Optional override for the chip label; defaults to template.label. */
  chipLabel?: string;
}

export function SkillTemplateCard({
  template,
  footerLabel,
  href,
  onClick,
  chipLabel,
}: SkillTemplateCardProps) {
  const theme = SKILL_KIND_THEME[template.kind];
  const Icon = theme.Icon;
  const stepCount = template.steps.length;

  const className = cn(
    "group flex h-full w-full flex-col items-stretch gap-4 rounded-2xl border border-border/70 bg-card p-5 text-left no-underline shadow-sm transition",
    theme.hoverRing,
    "hover:shadow-md",
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex size-12 items-center justify-center rounded-2xl", theme.icon)}>
          <Icon className="size-6" />
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
            theme.chip,
          )}
        >
          {chipLabel ?? template.label}
        </span>
      </div>

      <div className="flex-1">
        <h3 className="text-base font-semibold text-foreground">{template.label}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {template.description}
        </p>
        <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          {stepCount}단계
        </p>
      </div>

      <div className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition group-hover:gap-2">
        {footerLabel}
        <ArrowRight className="size-4" />
      </div>
    </>
  );

  if (href) {
    return (
      <Link to={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}
