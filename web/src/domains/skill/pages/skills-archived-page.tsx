import { Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useMdTemplates } from "@/domains/template/hooks";
import type { MdTemplateDefinition } from "@/domains/template/types";
import { ArchiveCardActions } from "@/shared/components/archive-card-actions";
import { ArchiveEmpty } from "@/shared/components/archive-empty";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { cn } from "@/shared/lib/utils";
import { skillKindTheme } from "../lib/skill-kind-theme";

export function SkillsArchivedPage() {
  const { archivedTemplates, deleteTemplate, restoreTemplate } = useMdTemplates();
  const navigate = useNavigate();

  function handleDelete(skill: MdTemplateDefinition) {
    const ok = window.confirm(`"${skill.title}" 스킬을 영구 삭제할까요? 되돌릴 수 없어요.`);
    if (!ok) return;
    deleteTemplate(skill.id);
    toast.success("스킬을 삭제했습니다.");
  }

  function handleRestore(skill: MdTemplateDefinition) {
    restoreTemplate(skill.id);
    toast.success("스킬을 복원했습니다.", { description: skill.title });
    navigate(`/skills/${encodeURIComponent(skill.id)}`);
  }

  return (
    <PageContainer>
      <PageHeader
        title="스킬 보관함"
        description="더 이상 사용하지 않는 스킬을 모아둡니다. 여기에서만 영구 삭제할 수 있어요."
      />

      {archivedTemplates.length === 0 ? (
        <ArchiveEmpty
          icon={Sparkles}
          title="보관된 스킬이 없습니다."
          description="스킬 상세에서 보관 버튼을 누르면 여기로 옮겨와요."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {archivedTemplates.map((skill) => (
            <li key={skill.id}>
              <ArchivedSkillCard
                skill={skill}
                onDelete={() => handleDelete(skill)}
                onRestore={() => handleRestore(skill)}
              />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

function ArchivedSkillCard({
  skill,
  onDelete,
  onRestore,
}: {
  skill: MdTemplateDefinition;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const theme = skillKindTheme(skill);
  const Icon = theme.Icon;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/70 bg-muted/30 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex size-10 items-center justify-center rounded-xl opacity-80", theme.icon)}>
          <Icon className="size-5" />
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium opacity-80",
            theme.chip,
          )}
        >
          {skill.triggerLabel}
        </span>
      </div>

      <div className="mt-3 min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{skill.title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {skill.description}
        </p>
      </div>

      <div className="mt-4 flex justify-end">
        <ArchiveCardActions onDelete={onDelete} onRestore={onRestore} />
      </div>
    </div>
  );
}
