import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { SkillTemplateCard } from "../components/skill-template-card";
import { SKILL_TEMPLATE_LIST } from "../lib/skill-template-catalog";
import { useMdTemplates } from "@/domains/template/hooks";
import { useMiniTour } from "@/domains/onboarding/use-mini-tour";

export function SkillTemplateCatalogPage() {
  const { userTemplates } = useMdTemplates();
  useMiniTour({
    key: "skill-templates",
    enabled: userTemplates.length === 0,
    spotlight: {
      element: '[data-tour="template-grid"]',
      side: "top",
      align: "center",
      title: "관심 있는 카테고리를 골라요",
      description:
        "원하는 갈래의 카드를 누르면 만들기 위저드가 시작돼요. 위저드가 끝나면 직원에 자동 장착할 수 있어요.",
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="스킬 템플릿"
        description="관리자가 관리하는 4가지 마스터 템플릿입니다. 카드를 누르면 해당 템플릿이 묻는 질문을 미리 볼 수 있어요."
      />

      <div data-tour="template-grid" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
