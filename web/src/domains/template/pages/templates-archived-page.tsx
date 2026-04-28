import { LayoutTemplate } from "lucide-react";

import { ArchiveEmpty } from "@/shared/components/archive-empty";
import { PageContainer, PageHeader } from "@/shared/components/page-container";

export function TemplatesArchivedPage() {
  return (
    <PageContainer>
      <PageHeader
        title="스킬 템플릿 보관함"
        description="삭제하기 전에 잠시 보관해두는 스킬 템플릿입니다. 여기에서만 영구 삭제할 수 있어요."
      />
      <ArchiveEmpty
        icon={LayoutTemplate}
        title="보관된 스킬 템플릿이 없습니다."
        description="템플릿 목록에서 보관함으로 옮긴 항목이 여기에 모입니다."
      />
    </PageContainer>
  );
}
