import {
  BarChart3,
  FileText,
  Languages,
  Mail,
  NotebookPen,
  PenLine,
  Search,
  type LucideIcon,
} from "lucide-react";

import type { MdTemplateDefinition } from "@/domains/template/types";
import type { SkillKind } from "./skill-template-catalog";

export interface SkillKindTheme {
  /** Container for the icon (background + foreground). */
  icon: string;
  /** Slim icon variant used inside compact contexts (e.g., chip leading icon). */
  iconText: string;
  /** Trigger-label chip style (background + text + border). */
  chip: string;
  /** Hover/active border accent for cards. */
  hoverRing: string;
  /** Solid accent line/dot color (e.g., timeline dots). */
  accent: string;
  Icon: LucideIcon;
}

export const SKILL_KIND_THEME: Record<SkillKind, SkillKindTheme> = {
  document: {
    icon: "bg-sky-100 text-sky-600",
    iconText: "text-sky-600",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    hoverRing: "hover:border-sky-300 hover:bg-sky-50/30",
    accent: "bg-sky-500",
    Icon: FileText,
  },
  content: {
    icon: "bg-rose-100 text-rose-600",
    iconText: "text-rose-600",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
    hoverRing: "hover:border-rose-300 hover:bg-rose-50/30",
    accent: "bg-rose-500",
    Icon: PenLine,
  },
  data: {
    icon: "bg-emerald-100 text-emerald-600",
    iconText: "text-emerald-600",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    hoverRing: "hover:border-emerald-300 hover:bg-emerald-50/30",
    accent: "bg-emerald-500",
    Icon: BarChart3,
  },
  translation: {
    icon: "bg-violet-100 text-violet-600",
    iconText: "text-violet-600",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
    hoverRing: "hover:border-violet-300 hover:bg-violet-50/30",
    accent: "bg-violet-500",
    Icon: Languages,
  },
  research: {
    icon: "bg-indigo-100 text-indigo-600",
    iconText: "text-indigo-600",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
    hoverRing: "hover:border-indigo-300 hover:bg-indigo-50/30",
    accent: "bg-indigo-500",
    Icon: Search,
  },
  summary: {
    icon: "bg-amber-100 text-amber-700",
    iconText: "text-amber-700",
    chip: "bg-amber-50 text-amber-800 border-amber-200",
    hoverRing: "hover:border-amber-300 hover:bg-amber-50/30",
    accent: "bg-amber-500",
    Icon: NotebookPen,
  },
  message: {
    icon: "bg-teal-100 text-teal-700",
    iconText: "text-teal-700",
    chip: "bg-teal-50 text-teal-800 border-teal-200",
    hoverRing: "hover:border-teal-300 hover:bg-teal-50/30",
    accent: "bg-teal-500",
    Icon: Mail,
  },
};

/**
 * Infer the skill kind from a saved MdTemplateDefinition. Uses the triggerLabel
 * first (e.g., "번역" → translation) and falls back to category.
 */
export function inferSkillKind(template: Pick<MdTemplateDefinition, "triggerLabel" | "category">): SkillKind {
  const trigger = template.triggerLabel.trim();
  if (trigger === "번역") return "translation";
  if (trigger === "콘텐츠 제작") return "content";
  if (trigger === "데이터 분석") return "data";
  if (trigger === "문서 자동화") return "document";
  if (trigger === "리서치") return "research";
  if (trigger === "요약 정리") return "summary";
  if (trigger === "메시지·이메일 작성") return "message";

  if (template.category === "content") return "content";
  if (template.category === "data") return "data";
  return "document";
}

export function skillKindTheme(template: Pick<MdTemplateDefinition, "triggerLabel" | "category">): SkillKindTheme {
  return SKILL_KIND_THEME[inferSkillKind(template)];
}
