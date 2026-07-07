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
  "shell.search": "검색",
  "shell.integrations": "연동",
  "shell.favorites": "즐겨찾기",
  "shell.tasks": "작업",
  "shell.skills": "공용 스킬",
  "shell.agents": "내 에이전트",
  "shell.skillTemplates": "스킬 템플릿",
  "shell.archive": "보관함",
  "shell.skillsArchive": "공용 스킬 보관함",
  "shell.agentsArchive": "내 에이전트 보관함",
  "header.searchPlaceholder": "작업 / 스킬 / 에이전트를 검색해보세요",
  "header.searchAria": "작업, 스킬, 에이전트 검색",
  "home.emptyTitle": "어떤 작업을 시작할까요?",
  "home.emptyDescription": "스킬을 고르거나 자료를 올려 Rocky에게 바로 요청하세요.",
  "chat.addMaterial": "자료 추가",
  "chat.chooseMaterialFile": "자료 파일 선택",
  "chat.composerPlaceholder": "PPT나 자료를 넣고 원하는 일을 말해보세요.",
  "chat.composerAria": "Rocky에게 말하기",
  "chat.stopping": "중지 중",
  "chat.stopResponse": "응답 중지",
  "chat.sending": "전송 중",
  "chat.send": "보내기",
  "task.noDate": "아직 없음",
  "task.sectionEyebrow": "단일 작업",
  "task.savedTitle": "저장된 재사용 작업",
  "task.savedDescription":
    "하네스 세션에서 검증된 작업을 저장해두고, 수동 실행, 주기 실행, Webhook 이벤트 트리거로 반복 재사용합니다.",
  "task.createSaved": "저장된 작업 만들기",
  "task.activeTasks": "활성 작업",
  "task.loadingSaved": "저장된 단일 작업을 불러오는 중입니다.",
  "task.emptySaved":
    "저장된 단일 작업이 없습니다. 검증된 프롬프트를 작업으로 저장해 반복 실행할 수 있습니다.",
  "task.noDescription": "설명이 없습니다.",
  "task.idle": "대기",
  "task.archived": "보관됨",
  "desktop.file": "파일",
  "desktop.edit": "편집",
  "desktop.view": "보기",
  "desktop.help": "도움말",
  "desktop.back": "뒤로 가기",
  "desktop.forward": "앞으로 가기",
  "desktop.toggleSidebar": "사이드바 토글",
  "desktop.appMenu": "앱 메뉴",
  "breadcrumb.agentTask": "작업 요청",
  "breadcrumb.newAgent": "새 에이전트",
  "breadcrumb.newSkill": "새 스킬",
  "breadcrumb.externalSkill": "외부 스킬 추가",
  "breadcrumb.newTemplate": "새 템플릿",
  "breadcrumb.runHistory": "실행 기록",
  "settings.title": "설정",
  "settings.description":
    "AI 서비스 연결 상태와 로컬 AI 실행에 영향을 주는 하드웨어 상태를 한곳에서 확인합니다.",
  "settings.loadingTitle": "AI 서비스 상태를 불러오는 중입니다",
  "settings.loadingDescription":
    "Codex와 Claude 로그인 상태, 설치 상태, 사용량 정보를 읽고 있습니다.",
  "settings.errorTitle": "AI 서비스 상태를 불러올 수 없습니다",
  "settings.errorDescription": "현재 계정 및 CLI 상태를 불러올 수 없습니다.",
  "settings.emptyTitle": "AI 서비스 정보를 찾을 수 없습니다",
  "settings.emptyDescription": "Codex 또는 Claude 서비스 응답이 비어 있습니다.",
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
  "shell.search": "Search",
  "shell.integrations": "Integrations",
  "shell.favorites": "Favorites",
  "shell.tasks": "Tasks",
  "shell.skills": "Shared skills",
  "shell.agents": "My agents",
  "shell.skillTemplates": "Skill templates",
  "shell.archive": "Archive",
  "shell.skillsArchive": "Shared skill archive",
  "shell.agentsArchive": "My agent archive",
  "header.searchPlaceholder": "Search tasks, skills, and agents",
  "header.searchAria": "Search tasks, skills, and agents",
  "home.emptyTitle": "What should we start?",
  "home.emptyDescription": "Pick a skill or upload material and ask Rocky directly.",
  "chat.addMaterial": "Add material",
  "chat.chooseMaterialFile": "Choose material files",
  "chat.composerPlaceholder": "Add a deck or source material, then describe what you need.",
  "chat.composerAria": "Message Rocky",
  "chat.stopping": "Stopping",
  "chat.stopResponse": "Stop response",
  "chat.sending": "Sending",
  "chat.send": "Send",
  "task.noDate": "None yet",
  "task.sectionEyebrow": "Single task",
  "task.savedTitle": "Saved reusable tasks",
  "task.savedDescription":
    "Save work proven in a harness session and reuse it through manual runs, schedules, or webhook events.",
  "task.createSaved": "Create saved task",
  "task.activeTasks": "Active tasks",
  "task.loadingSaved": "Loading saved single tasks.",
  "task.emptySaved":
    "No saved single tasks yet. Save a proven prompt as a task to run it repeatedly.",
  "task.noDescription": "No description.",
  "task.idle": "Idle",
  "task.archived": "Archived",
  "desktop.file": "File",
  "desktop.edit": "Edit",
  "desktop.view": "View",
  "desktop.help": "Help",
  "desktop.back": "Go back",
  "desktop.forward": "Go forward",
  "desktop.toggleSidebar": "Toggle sidebar",
  "desktop.appMenu": "App menu",
  "breadcrumb.agentTask": "Task request",
  "breadcrumb.newAgent": "New agent",
  "breadcrumb.newSkill": "New skill",
  "breadcrumb.externalSkill": "Add external skill",
  "breadcrumb.newTemplate": "New template",
  "breadcrumb.runHistory": "Run history",
  "settings.title": "Settings",
  "settings.description":
    "Review AI service connections and hardware status that affects local AI execution.",
  "settings.loadingTitle": "Loading AI service status",
  "settings.loadingDescription":
    "Reading Codex and Claude login status, install status, and usage information.",
  "settings.errorTitle": "Could not load AI service status",
  "settings.errorDescription": "Current account and CLI status could not be loaded.",
  "settings.emptyTitle": "AI service information was not found",
  "settings.emptyDescription": "The Codex or Claude service response is empty.",
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
