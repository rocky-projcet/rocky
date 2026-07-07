import { Languages } from "lucide-react";

import { SUPPORTED_LOCALES, type Locale } from "@/shared/lib/i18n";
import { useI18n } from "@/shared/lib/i18n-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <Select
      value={locale}
      onValueChange={(value) => setLocale(value as Locale)}
    >
      <SelectTrigger
        aria-label={t("locale.switcherLabel")}
        className="h-9 w-[104px] rounded-full px-3 text-xs"
      >
        <Languages className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="rounded-2xl">
        {SUPPORTED_LOCALES.map((entry) => (
          <SelectItem key={entry} value={entry}>
            {t(`locale.${entry}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
