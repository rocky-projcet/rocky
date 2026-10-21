export const DEFAULT_LOCALE = "ko" as const;
export const SUPPORTED_LOCALES = ["ko", "en"] as const;
export const LOCALE_STORAGE_KEY = "rocky.locale";

export type Locale = (typeof SUPPORTED_LOCALES)[number];

const ko = {
  "common.loading": "불러오는 중입니다.",
  "common.error": "오류",
  "common.missing": "누락",
  "locale.switcherLabel": "언어 선택",
  "locale.ko": "한국어",
  "locale.en": "English",
  "shell.home": "홈",
  "shell.agents": "내 에이전트",
  "shell.archive": "보관함",
  "shell.agentsArchive": "내 에이전트 보관함",
  "shell.settings": "설정",
  "desktop.file": "파일",
  "desktop.edit": "편집",
  "desktop.view": "보기",
  "desktop.help": "도움말",
  "desktop.back": "뒤로 가기",
  "desktop.forward": "앞으로 가기",
  "desktop.toggleSidebar": "사이드바 토글",
  "desktop.appMenu": "앱 메뉴",
  "breadcrumb.newAgent": "새 에이전트",
  "settings.title": "설정",
  "settings.description": "로컬 AI 실행에 영향을 주는 하드웨어 상태를 확인해요.",
} as const;

type MessageKey = keyof typeof ko;

const en = {
  "common.loading": "Loading.",
  "common.error": "Error",
  "common.missing": "Missing",
  "locale.switcherLabel": "Select language",
  "locale.ko": "한국어",
  "locale.en": "English",
  "shell.home": "Home",
  "shell.agents": "My agents",
  "shell.archive": "Archive",
  "shell.agentsArchive": "My agent archive",
  "shell.settings": "Settings",
  "desktop.file": "File",
  "desktop.edit": "Edit",
  "desktop.view": "View",
  "desktop.help": "Help",
  "desktop.back": "Go back",
  "desktop.forward": "Go forward",
  "desktop.toggleSidebar": "Toggle sidebar",
  "desktop.appMenu": "App menu",
  "breadcrumb.newAgent": "New agent",
  "settings.title": "Settings",
  "settings.description": "Review hardware status that affects local AI execution.",
} satisfies Record<MessageKey, string>;

export const messageCatalogs: Record<Locale, Record<MessageKey, string>> = {
  ko,
  en,
};

export type I18nKey = MessageKey;

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_LOCALE;
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  if (normalized.startsWith("ko")) {
    return "ko";
  }

  return DEFAULT_LOCALE;
}

export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const catalog = messageCatalogs[locale];
  const defaultCatalog = messageCatalogs[DEFAULT_LOCALE];
  return (
    catalog[key as MessageKey] ??
    defaultCatalog[key as MessageKey] ??
    key
  );
}

export function getCatalogCoverage(): Record<Locale, string[]> {
  const allKeys = new Set<string>();
  for (const catalog of Object.values(messageCatalogs)) {
    for (const key of Object.keys(catalog)) {
      allKeys.add(key);
    }
  }

  return {
    en: [...allKeys].filter((key) => !messageCatalogs.en[key as MessageKey]),
    ko: [...allKeys].filter((key) => !messageCatalogs.ko[key as MessageKey]),
  };
}
