import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { useI18n } from "@/shared/lib/i18n-provider";
import { HardwareStatusPanel } from "../components/hardware-status-panel";

export function SettingsPage() {
  const { t } = useI18n();

  return (
    <PageContainer>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />

      <p className="text-sm text-muted-foreground">
        하드웨어 상태는 10초마다 자동으로 새로 읽습니다.
      </p>

      <HardwareStatusPanel enabled />
    </PageContainer>
  );
}
