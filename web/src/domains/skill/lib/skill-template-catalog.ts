import type { MdTemplateCategory } from "@/domains/template/types";

export type SkillKind = "document" | "content" | "data" | "translation";

export type SkillFieldKind =
  | "single-select"
  | "single-select-with-detail"
  | "multi-select"
  | "file-upload"
  | "file-with-role"
  | "language-pair"
  | "text"
  | "url-or-file";

export interface SkillFieldOption {
  id: string;
  label: string;
  description?: string;
  /** Sub-options revealed when this option is picked (used by single-select-with-detail). */
  detailOptions?: SkillFieldOption[];
  detailLabel?: string;
}

export interface SkillField {
  id: string;
  kind: SkillFieldKind;
  label: string;
  helper?: string;
  options?: SkillFieldOption[];
  /** When true, the user can also free-text instead of picking. */
  allowCustom?: boolean;
  /** Required vs optional/skip. */
  optional?: boolean;
  placeholder?: string;
  /** For file fields: accepted MIME hints. */
  accept?: string;
}

export interface SkillStep {
  id: string;
  title: string;
  helper?: string;
  fields: SkillField[];
  /** When true, allow user to skip this step entirely. */
  skippable?: boolean;
}

export interface SkillTemplate {
  kind: SkillKind;
  label: string;
  description: string;
  /** Used when saving to MdTemplate to keep server enum stable. */
  fallbackCategory: MdTemplateCategory;
  steps: SkillStep[];
}

const COMMON_OUTPUT_FORMATS: SkillFieldOption[] = [
  { id: "pdf", label: "PDF" },
  { id: "png", label: "PNG (이미지)" },
  { id: "html", label: "HTML" },
  { id: "docx", label: "Word (.docx)" },
  { id: "xlsx", label: "Excel (.xlsx)" },
  {
    id: "all",
    label: "모두 (시간이 더 걸려요)",
    description: "여러 형식으로 동시에 만들면 처리가 길어질 수 있어요.",
  },
];

const DOCUMENT_TEMPLATE: SkillTemplate = {
  kind: "document",
  label: "문서 작업",
  description: "견적서, 인보이스 같은 정형 문서를 자동으로 만들어요.",
  fallbackCategory: "document",
  steps: [
    {
      id: "doc-type",
      title: "어떤 문서인가요?",
      helper: "가장 가까운 항목을 골라주세요. 없으면 직접 입력할 수 있어요.",
      fields: [
        {
          id: "documentType",
          kind: "single-select",
          label: "문서 종류",
          allowCustom: true,
          options: [
            { id: "quote", label: "견적서" },
            { id: "invoice", label: "인보이스" },
            { id: "report", label: "보고서" },
            { id: "packing", label: "패킹 리스트" },
            { id: "transaction", label: "거래명세서" },
            { id: "purchase-order", label: "발주서" },
            { id: "contract", label: "계약서" },
            { id: "receipt", label: "영수증/지출결의서" },
            { id: "memo", label: "공문/내부 메모" },
          ],
        },
      ],
    },
    {
      id: "doc-reference",
      title: "기존 문서를 올려주세요",
      helper: "같은 양식이 있으면 첨부해 주세요. 없으면 건너뛰어도 됩니다.",
      skippable: true,
      fields: [
        {
          id: "referenceFile",
          kind: "file-upload",
          label: "기존 문서",
          accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.txt",
          optional: true,
        },
      ],
    },
    {
      id: "doc-attachments",
      title: "함께 쓸 파일이 있나요?",
      helper: "서명 이미지, 로고, 인감 등 매번 들어가는 자료를 미리 등록해 두세요.",
      skippable: true,
      fields: [
        {
          id: "attachments",
          kind: "file-with-role",
          label: "파일과 역할",
          helper: "예: 서명 이미지 → 결재란, 회사 로고 → 머리글",
          optional: true,
        },
      ],
    },
    {
      id: "doc-output",
      title: "결과물 형식",
      helper: "여러 개를 골라도 돼요.",
      fields: [
        {
          id: "outputFormats",
          kind: "multi-select",
          label: "파일 형식",
          options: COMMON_OUTPUT_FORMATS,
        },
      ],
    },
    {
      id: "doc-rules",
      title: "지키거나 피해야 할 규칙이 있나요?",
      helper: "체크하지 않거나 직접 적어 추가할 수 있어요.",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "no-other-channel-revenue", label: "다른 채널 매출은 언급 금지" },
            { id: "no-internal-codename", label: "내부 코드명은 그대로 노출하지 않기" },
            { id: "exclude-discount", label: "할인 가격은 표기하지 않기" },
            { id: "use-our-brand-only", label: "자사 브랜드만 사용 (외부 브랜드 노출 금지)" },
            { id: "fixed-currency-krw", label: "통화는 KRW로 통일" },
            { id: "include-tax-line", label: "부가세 라인 항상 포함" },
            { id: "redact-personal", label: "개인정보(주민/연락처) 마스킹" },
          ],
        },
      ],
    },
  ],
};

const CONTENT_TEMPLATE: SkillTemplate = {
  kind: "content",
  label: "콘텐츠 스킬",
  description: "SNS 글, 상세페이지, 블로그 글 등 채널 맞춤 콘텐츠를 만들어요.",
  fallbackCategory: "content",
  steps: [
    {
      id: "content-channel",
      title: "어떤 콘텐츠인가요?",
      helper: "채널을 고르면 그에 맞는 길이와 톤으로 작성해요.",
      fields: [
        {
          id: "channel",
          kind: "single-select-with-detail",
          label: "콘텐츠 종류",
          allowCustom: true,
          options: [
            {
              id: "sns",
              label: "SNS",
              detailLabel: "어느 SNS인가요?",
              detailOptions: [
                { id: "instagram", label: "Instagram (피드)" },
                { id: "instagram-reels", label: "Instagram (릴스)" },
                { id: "threads", label: "Threads" },
                { id: "facebook", label: "Facebook" },
                { id: "x", label: "X (Twitter)" },
                { id: "linkedin", label: "LinkedIn" },
                { id: "youtube-shorts", label: "YouTube Shorts" },
                { id: "tiktok", label: "TikTok" },
              ],
            },
            { id: "detail-page", label: "홈페이지 상세페이지" },
            {
              id: "blog",
              label: "블로그",
              detailLabel: "어느 블로그인가요?",
              detailOptions: [
                { id: "naver", label: "네이버 블로그" },
                { id: "brunch", label: "브런치" },
                { id: "tistory", label: "티스토리" },
                { id: "kakao-channel", label: "카카오 채널" },
                { id: "medium", label: "Medium" },
              ],
            },
            { id: "newsletter", label: "뉴스레터" },
          ],
        },
      ],
    },
    {
      id: "content-reference",
      title: "기존 콘텐츠를 보여주세요",
      helper: "URL이나 파일을 올리면 분위기와 페르소나를 분석해서 톤을 맞춰드려요.",
      skippable: true,
      fields: [
        {
          id: "referenceContent",
          kind: "url-or-file",
          label: "기존 콘텐츠",
          optional: true,
        },
      ],
    },
    {
      id: "content-persona",
      title: "어떤 말투로 쓸까요?",
      helper: "여러 개 골라도 됩니다.",
      fields: [
        {
          id: "personaTone",
          kind: "multi-select",
          label: "말투",
          options: [
            { id: "polite", label: "공손한 경어" },
            { id: "friendly", label: "친근한 반말" },
            { id: "professional", label: "전문가 톤" },
            { id: "playful", label: "유쾌·캐주얼" },
            { id: "emotional", label: "감성적·서정" },
            { id: "minimal", label: "간결·미니멀" },
          ],
        },
        {
          id: "emojiUsage",
          kind: "single-select",
          label: "이모지 사용",
          options: [
            { id: "none", label: "거의 안 씀" },
            { id: "subtle", label: "포인트로만" },
            { id: "rich", label: "자주 사용" },
          ],
        },
      ],
    },
    {
      id: "content-target",
      title: "타겟층을 알려주세요",
      skippable: true,
      fields: [
        {
          id: "gender",
          kind: "single-select",
          label: "성별",
          options: [
            { id: "all", label: "전체" },
            { id: "female", label: "여성" },
            { id: "male", label: "남성" },
          ],
        },
        {
          id: "ageRange",
          kind: "multi-select",
          label: "나이대",
          options: [
            { id: "10s", label: "10대" },
            { id: "20s", label: "20대" },
            { id: "30s", label: "30대" },
            { id: "40s", label: "40대" },
            { id: "50s+", label: "50대 이상" },
          ],
        },
        {
          id: "occupation",
          kind: "multi-select",
          label: "직업·관심사",
          allowCustom: true,
          options: [
            { id: "office", label: "직장인" },
            { id: "student", label: "학생" },
            { id: "parent", label: "부모/주부" },
            { id: "freelancer", label: "프리랜서·1인기업" },
            { id: "executive", label: "임원·결정권자" },
            { id: "creator", label: "크리에이터" },
          ],
        },
      ],
    },
    {
      id: "content-attachments",
      title: "함께 쓸 파일이 있나요?",
      helper: "제품 이미지, 로고, 가이드 문서 등을 올려주세요.",
      skippable: true,
      fields: [
        {
          id: "assets",
          kind: "file-with-role",
          label: "파일과 역할",
          helper: "예: 제품 컷 → 메인 이미지, 로고 → 마무리 워터마크",
          optional: true,
        },
      ],
    },
    {
      id: "content-rules",
      title: "지키거나 피해야 할 규칙이 있나요?",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "no-competitor", label: "타 브랜드 언급 금지" },
            { id: "no-political", label: "정치·종교 표현 금지" },
            { id: "no-medical-claim", label: "효능·의료 표현 금지" },
            { id: "no-superlative", label: "최상급 표현(최고/유일) 금지" },
            { id: "include-hashtags", label: "해시태그 5개 이상 포함" },
            { id: "include-cta", label: "CTA 문구 포함" },
            { id: "preserve-brand-name", label: "브랜드명·제품명 변경 금지" },
          ],
        },
      ],
    },
  ],
};

const DATA_TEMPLATE: SkillTemplate = {
  kind: "data",
  label: "데이터 분석 스킬",
  description: "엑셀·CSV 같은 데이터를 분석하고 인사이트를 정리해요.",
  fallbackCategory: "data",
  steps: [
    {
      id: "data-kind",
      title: "어떤 분석인가요?",
      helper: "분석의 큰 갈래를 골라주세요.",
      fields: [
        {
          id: "analysisKind",
          kind: "single-select",
          label: "분석 갈래",
          allowCustom: true,
          options: [
            { id: "sales", label: "매출 분석" },
            { id: "promotion", label: "프로모션 성과" },
            { id: "kpi", label: "KPI·성과지표" },
            { id: "customer", label: "고객 행동·세그먼트" },
            { id: "inventory", label: "재고·회전율" },
            { id: "marketing-roi", label: "마케팅 ROI" },
            { id: "channel-compare", label: "채널 비교" },
            { id: "trend", label: "트렌드 변화" },
          ],
        },
      ],
    },
    {
      id: "data-purpose",
      title: "분석의 목적은 무엇인가요?",
      helper: "여러 개 골라도 좋아요.",
      fields: [
        {
          id: "purpose",
          kind: "multi-select",
          label: "목적",
          allowCustom: true,
          options: [
            { id: "increase-sales", label: "매출 증대" },
            { id: "promo-effect", label: "홍보 효과 측정" },
            { id: "select-influencer", label: "인플루언서 선정" },
            { id: "find-target", label: "타겟층 분석" },
            { id: "optimize-stock", label: "재고 최적화" },
            { id: "trend-watch", label: "트렌드 파악" },
            { id: "report-board", label: "임원 보고용 요약" },
          ],
        },
      ],
    },
    {
      id: "data-files",
      title: "분석할 데이터를 올려주세요",
      helper: "어떤 데이터인지 한 줄로 설명해 주세요.",
      fields: [
        {
          id: "datasets",
          kind: "file-with-role",
          label: "데이터 파일과 설명",
          helper: "예: 매출_2025.xlsx → 채널별 월매출 / customers.csv → 회원 정보",
        },
      ],
    },
    {
      id: "data-rules",
      title: "분석에서 빼거나 피할 부분이 있나요?",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "skip-pii", label: "개인정보 컬럼은 분석/노출 금지" },
            { id: "skip-test-data", label: "테스트 데이터(채널=test 등)는 제외" },
            { id: "skip-internal-channel", label: "내부 채널 매출은 별도 표기" },
            { id: "exclude-outliers", label: "이상치(극단값) 자동 제외" },
            { id: "fixed-period-monthly", label: "기간은 월 단위로만 집계" },
            { id: "no-prediction", label: "추측·예측은 하지 않기" },
          ],
        },
      ],
    },
    {
      id: "data-output",
      title: "결과물 형식",
      fields: [
        {
          id: "outputFormats",
          kind: "multi-select",
          label: "파일 형식",
          options: [
            { id: "summary-md", label: "요약 리포트 (Markdown)" },
            { id: "chart-png", label: "차트 이미지 (PNG)" },
            { id: "xlsx", label: "정리된 Excel" },
            { id: "pdf", label: "PDF 보고서" },
            {
              id: "all",
              label: "모두 (시간이 더 걸려요)",
              description: "여러 형식으로 동시에 만들면 처리가 길어질 수 있어요.",
            },
          ],
        },
      ],
    },
  ],
};

const TRANSLATION_TEMPLATE: SkillTemplate = {
  kind: "translation",
  label: "번역 스킬",
  description: "문서·텍스트를 정해진 톤으로 번역해요.",
  fallbackCategory: "document",
  steps: [
    {
      id: "translation-language",
      title: "어떤 언어로 번역할까요?",
      fields: [
        {
          id: "languagePair",
          kind: "language-pair",
          label: "언어 짝",
        },
      ],
    },
    {
      id: "translation-tone",
      title: "어떤 말투로 번역할까요?",
      fields: [
        {
          id: "tone",
          kind: "single-select",
          label: "말투",
          options: [
            { id: "formal", label: "격식체·비즈니스" },
            { id: "polite", label: "공손한 경어" },
            { id: "casual", label: "친근한 일상체" },
            { id: "marketing", label: "마케팅·세일즈" },
            { id: "literary", label: "문학·서정" },
            { id: "technical", label: "기술 문서" },
          ],
        },
      ],
    },
    {
      id: "translation-source",
      title: "무엇을 번역할까요?",
      helper: "파일을 올리거나 텍스트로 입력해도 돼요.",
      fields: [
        {
          id: "sourceKind",
          kind: "single-select",
          label: "원본 형태",
          options: [
            { id: "text", label: "그냥 텍스트" },
            { id: "pdf", label: "PDF" },
            { id: "docx", label: "Word (.docx)" },
            { id: "pptx", label: "PowerPoint (.pptx)" },
            { id: "xlsx", label: "Excel (.xlsx)" },
            { id: "subtitle", label: "자막 (.srt/.vtt)" },
          ],
        },
        {
          id: "sourceFile",
          kind: "file-upload",
          label: "원본 파일",
          optional: true,
          accept: ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.srt,.vtt,.txt",
        },
      ],
    },
    {
      id: "translation-rules",
      title: "지킬 규칙이 있나요?",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "preserve-brand", label: "브랜드명·제품명은 그대로 둠" },
            { id: "preserve-proper-nouns", label: "고유명사·인명은 원어 표기" },
            { id: "convert-units", label: "단위(파운드/마일) 자동 변환" },
            { id: "convert-currency", label: "통화는 자동 변환" },
            { id: "keep-formatting", label: "문서의 표·서식 유지" },
            { id: "no-localization", label: "현지화(예시 변경) 하지 않기" },
            { id: "use-glossary", label: "사전(용어집)을 우선 사용" },
          ],
        },
      ],
    },
  ],
};

export const SKILL_TEMPLATES: Record<SkillKind, SkillTemplate> = {
  document: DOCUMENT_TEMPLATE,
  content: CONTENT_TEMPLATE,
  data: DATA_TEMPLATE,
  translation: TRANSLATION_TEMPLATE,
};

export const SKILL_TEMPLATE_LIST: SkillTemplate[] = [
  DOCUMENT_TEMPLATE,
  CONTENT_TEMPLATE,
  DATA_TEMPLATE,
  TRANSLATION_TEMPLATE,
];

export const LANGUAGE_OPTIONS: SkillFieldOption[] = [
  { id: "ko", label: "한국어" },
  { id: "en", label: "영어" },
  { id: "ja", label: "일본어" },
  { id: "zh-Hans", label: "중국어 (간체)" },
  { id: "zh-Hant", label: "중국어 (번체)" },
  { id: "vi", label: "베트남어" },
  { id: "th", label: "태국어" },
  { id: "id", label: "인도네시아어" },
  { id: "fr", label: "프랑스어" },
  { id: "de", label: "독일어" },
  { id: "es", label: "스페인어" },
  { id: "pt", label: "포르투갈어" },
];
