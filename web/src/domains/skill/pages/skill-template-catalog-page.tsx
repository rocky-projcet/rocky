import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { SkillTemplateCard } from "../components/skill-template-card";
import { SKILL_TEMPLATE_LIST } from "../lib/skill-template-catalog";

export function SkillTemplateCatalogPage() {
  return (
    <PageContainer>
      <PageHeader
        title="스킬 템플릿"
        description="관리자가 관리하는 4가지 마스터 템플릿입니다. 카드를 누르면 해당 템플릿이 묻는 질문을 미리 볼 수 있어요."
      />

      <div data-tour="template-grid" className="grid gap-4 sm:grid-cols-2">
        {SKILL_TEMPLATE_LIST.map((template) => (
          <SkillTemplateCard
            key={template.kind}
            template={template}
            footerLabel="질문 미리 보기"
            href={`/templates/${encodeURIComponent(template.kind)}`}
          />
        ))}
      </div>
    </PageContainer>
  );
}
