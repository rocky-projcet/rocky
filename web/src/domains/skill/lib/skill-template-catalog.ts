import type { MdTemplateCategory } from "@/domains/template/types";

export type SkillKind =
  | "document"
  | "content"
  | "data"
  | "translation"
  | "research"
  | "summary"
  | "message"
  | "erp";

export type SkillFieldKind =
  | "single-select"
  | "single-select-with-detail"
  | "multi-select"
  | "file-upload"
  | "file-with-role"
  | "language-pair"
  | "text"
  | "url-or-file"
  | "account-connect"
  | "ecount-connection-test"
  | "recipient-address";

export interface SkillFieldOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
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
  defaultValue?: string;
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
          ],
        },
      ],
    },
    {
      id: "content-publish-account",
      title: "어느 계정으로 올릴까요?",
      helper:
        "골라주신 채널에 로그인이 필요해요. 처음이면 이 단계에서 계정을 연결해 주세요. 초안만 받고 직접 올리실 거면 건너뛰셔도 돼요.",
      skippable: true,
      fields: [
        {
          id: "publishAccount",
          kind: "account-connect",
          label: "발행할 계정",
          helper:
            "예) Instagram @brand, 네이버 블로그 ID, 뉴스레터 발송 계정. 연결된 계정이 없으면 '계정 연결하기'를 눌러주세요.",
          optional: true,
        },
        {
          id: "autoPublish",
          kind: "single-select",
          label: "발행 방식",
          options: [
            { id: "draft-only", label: "초안만 만들기 (직접 올림)" },
            { id: "review-then-publish", label: "확인 후 자동 발행" },
            { id: "schedule", label: "예약 발행" },
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
      id: "data-source",
      title: "데이터를 어디에서 가져올까요?",
      helper: "엑셀 파일만 쓸 수도 있고, 이카운트 ERP 데이터를 함께 볼 수도 있어요.",
      fields: [
        {
          id: "dataSource",
          kind: "single-select",
          label: "데이터 소스",
          options: [
            {
              id: "file-upload",
              label: "파일 업로드",
              description: "엑셀·CSV 파일을 올려서 분석합니다.",
            },
            {
              id: "ecount-erp",
              label: "이카운트 ERP",
              description: "이카운트의 품목·거래처·재고·판매 데이터를 조회해 분석합니다.",
            },
            {
              id: "file-and-ecount",
              label: "파일 + 이카운트 ERP",
              description: "업로드 파일과 ERP 데이터를 대조합니다.",
            },
          ],
        },
      ],
    },
    {
      id: "ecount-erp",
      title: "이카운트 ERP 조회 연동을 사용하나요?",
      helper:
        "이카운트 데이터를 쓰는 스킬이면 계정과 조회 범위를 적어주세요. 등록·수정은 추후 제공 예정입니다.",
      skippable: true,
      fields: [
        {
          id: "ecountConnectionTest",
          kind: "ecount-connection-test",
          label: "이카운트 연결 테스트",
          helper:
            "회사코드, 사용자 ID, API 인증키로 세션 발급까지 확인합니다. 인증키와 세션은 스킬 내용에 저장하지 않습니다.",
          placeholder: "예: 본사 이카운트",
          optional: true,
        },
        {
          id: "ecountDataScope",
          kind: "multi-select",
          label: "ERP 데이터 범위",
          allowCustom: true,
          options: [
            { id: "items", label: "품목" },
            { id: "customers", label: "거래처" },
            { id: "inventory", label: "재고현황" },
            { id: "warehouse-inventory", label: "창고별 재고" },
            { id: "orders", label: "주문서" },
            { id: "sales", label: "판매" },
            { id: "purchase", label: "구매" },
            { id: "accounting", label: "매출·매입" },
          ],
        },
        {
          id: "ecountPeriod",
          kind: "text",
          label: "조회 기간 또는 기준",
          placeholder: "예: 최근 30일, 이번 달, 2026-05-01~2026-05-31",
          optional: true,
        },
        {
          id: "ecountWritePolicy",
          kind: "single-select",
          label: "ERP 변경 작업",
          helper: "현재 ECOUNT ERP 연동은 조회와 분석만 허용합니다.",
          defaultValue: "read-only",
          options: [
            {
              id: "read-only",
              label: "조회와 분석만 허용",
              description: "품목·거래처·재고·판매 데이터를 읽어 분석하는 작업만 진행합니다.",
            },
            {
              id: "write-planned",
              label: "등록·수정은 추후 제공 예정",
              description: "ERP 전송, 생성, 수정, 삭제 작업은 현재 스킬에서 실행하지 않습니다.",
              disabled: true,
            },
          ],
        },
      ],
    },
    {
      id: "data-files",
      title: "분석할 데이터를 올려주세요",
      helper:
        "파일 없이 이카운트 ERP만 쓸 스킬이면 건너뛰어도 됩니다. 파일을 함께 쓰면 어떤 데이터인지 한 줄로 설명해 주세요.",
      skippable: true,
      fields: [
        {
          id: "datasets",
          kind: "file-with-role",
          label: "데이터 파일과 설명",
          helper: "예: 매출_2025.xlsx → 채널별 월매출 / customers.csv → 회원 정보",
          optional: true,
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

const RESEARCH_TEMPLATE: SkillTemplate = {
  kind: "research",
  label: "리서치 스킬",
  description: "시장·경쟁사·트렌드·문헌 등을 조사하고 핵심을 정리해요.",
  fallbackCategory: "document",
  steps: [
    {
      id: "research-subject",
      title: "무엇을 리서치할까요?",
      helper: "가장 가까운 항목을 골라주세요. 없으면 직접 입력할 수 있어요.",
      fields: [
        {
          id: "researchSubject",
          kind: "single-select",
          label: "조사 주제",
          allowCustom: true,
          options: [
            { id: "market-competitor", label: "시장·경쟁사 동향" },
            { id: "product-tech", label: "제품·기술 정보" },
            { id: "policy-regulation", label: "정책·법령·규제" },
            { id: "trend-consumer", label: "트렌드·소비자 인사이트" },
            { id: "company-people", label: "인물·기업 프로필" },
            { id: "academic", label: "학술 문헌·논문" },
            { id: "industry-case", label: "업계 사례·벤치마크" },
          ],
        },
      ],
    },
    {
      id: "research-sources",
      title: "어디에서 찾아볼까요?",
      helper: "여러 채널을 골라도 좋아요.",
      fields: [
        {
          id: "sourceChannels",
          kind: "multi-select",
          label: "참고 채널",
          allowCustom: true,
          options: [
            { id: "web-search", label: "웹 일반 검색" },
            { id: "news", label: "뉴스 기사" },
            { id: "public-stats", label: "공공 보고서·통계" },
            { id: "academic-source", label: "학술 논문·DB" },
            { id: "industry-media", label: "산업 협회·전문 매체" },
            { id: "company-disclosure", label: "기업 공시·IR" },
            { id: "attached-only", label: "첨부한 자료만 사용" },
          ],
        },
      ],
    },
    {
      id: "research-reference",
      title: "참고할 자료를 먼저 올려주세요",
      helper: "내부 문서나 좋은 레퍼런스 URL이 있으면 첨부해주세요. 없으면 건너뛰어도 됩니다.",
      skippable: true,
      fields: [
        {
          id: "referenceMaterial",
          kind: "url-or-file",
          label: "참고 자료",
          optional: true,
        },
      ],
    },
    {
      id: "research-output",
      title: "결과물 형식",
      fields: [
        {
          id: "outputFormats",
          kind: "multi-select",
          label: "파일 형식",
          options: [
            { id: "summary-md", label: "핵심 요약 (5~7줄)" },
            { id: "report-md", label: "상세 보고서 (Markdown)" },
            { id: "compare-xlsx", label: "비교표 (Excel)" },
            { id: "pdf", label: "PDF 보고서" },
            { id: "ppt", label: "슬라이드 (PPT)" },
            { id: "citations", label: "인용·출처 목록" },
            {
              id: "all",
              label: "모두 (시간이 더 걸려요)",
              description: "여러 형식을 동시에 만들면 처리가 길어질 수 있어요.",
            },
          ],
        },
      ],
    },
    {
      id: "research-rules",
      title: "지키거나 피할 규칙이 있나요?",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "no-speculation", label: "출처 없는 추측은 적지 않기" },
            { id: "korea-only", label: "한국 시장 한정" },
            { id: "recent-1y", label: "1년 이내 자료만 사용" },
            { id: "ko-only", label: "한국어 자료 위주" },
            { id: "no-competitor-bash", label: "경쟁사 비방 표현 금지" },
            { id: "redact-personal", label: "개인정보 마스킹" },
            { id: "include-citations", label: "주장마다 출처 표기" },
          ],
        },
      ],
    },
  ],
};

const SUMMARY_TEMPLATE: SkillTemplate = {
  kind: "summary",
  label: "요약 정리 스킬",
  description: "회의 녹음·긴 문서·기사·강의 등을 짧게 정리해요.",
  fallbackCategory: "document",
  steps: [
    {
      id: "summary-source",
      title: "무엇을 정리할까요?",
      helper: "원본의 종류를 골라주세요.",
      fields: [
        {
          id: "sourceKind",
          kind: "single-select-with-detail",
          label: "원본 종류",
          allowCustom: true,
          options: [
            {
              id: "meeting",
              label: "회의·대화",
              detailLabel: "어떤 회의인가요?",
              detailOptions: [
                { id: "regular", label: "정기 회의" },
                { id: "sales", label: "영업 미팅" },
                { id: "interview", label: "고객·사용자 인터뷰" },
                { id: "workshop", label: "워크샵·브레인스토밍" },
                { id: "one-on-one", label: "1:1 미팅" },
                { id: "hiring", label: "면접" },
              ],
            },
            { id: "long-doc", label: "긴 문서·보고서" },
            { id: "article", label: "기사·블로그 글" },
            { id: "video", label: "동영상·강의" },
            { id: "chat-log", label: "채팅·메시지 로그" },
          ],
        },
      ],
    },
    {
      id: "summary-files",
      title: "원본을 올려주세요",
      helper: "녹음(.m4a/.wav/.mp4), 텍스트, 문서 모두 가능해요.",
      fields: [
        {
          id: "sourceFiles",
          kind: "file-with-role",
          label: "원본 파일",
          helper: "예: 2025-12-회의록.m4a → 회의 녹음 / report.pdf → 분기 보고서",
        },
      ],
    },
    {
      id: "summary-output",
      title: "결과물 형식",
      helper: "여러 개 골라도 돼요.",
      fields: [
        {
          id: "outputFormats",
          kind: "multi-select",
          label: "정리 형식",
          options: [
            { id: "one-line", label: "한 줄 요약" },
            { id: "bullets-5", label: "핵심 요점 5개" },
            { id: "section-detail", label: "섹션별 상세 정리" },
            { id: "action-items", label: "액션 아이템·다음 단계" },
            { id: "speakers", label: "참석자별 발언·의견" },
            { id: "qa", label: "Q&A 정리" },
            { id: "decisions", label: "결정·합의 사항" },
            {
              id: "all",
              label: "모두 (시간이 더 걸려요)",
              description: "여러 정리를 동시에 만들면 처리가 길어질 수 있어요.",
            },
          ],
        },
      ],
    },
    {
      id: "summary-tone",
      title: "톤과 길이",
      fields: [
        {
          id: "tone",
          kind: "single-select",
          label: "말투",
          options: [
            { id: "formal", label: "격식체·보고용" },
            { id: "neutral", label: "보통 (중립적)" },
            { id: "casual", label: "친근·일상체" },
          ],
        },
        {
          id: "length",
          kind: "single-select",
          label: "길이",
          options: [
            { id: "tight", label: "짧고 핵심만" },
            { id: "balanced", label: "보통 (3~5문단)" },
            { id: "thorough", label: "상세 (전체 흐름 보존)" },
          ],
        },
      ],
    },
    {
      id: "summary-rules",
      title: "지키거나 피할 규칙이 있나요?",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "anonymize", label: "이름은 모두 익명화" },
            { id: "title-only", label: "직책만 표기 (이름 제거)" },
            { id: "exclude-pricing", label: "가격·인사 등 민감 정보 제외" },
            { id: "external-share", label: "외부 공유용 (간결·전문적)" },
            { id: "internal", label: "내부용 (구체·솔직)" },
            { id: "no-interpretation", label: "추측·해석 추가하지 않기" },
            { id: "preserve-quotes", label: "원문 인용은 그대로 유지" },
          ],
        },
      ],
    },
  ],
};

const MESSAGE_TEMPLATE: SkillTemplate = {
  kind: "message",
  label: "메시지·이메일 스킬",
  description: "이메일·메신저·문자를 상황과 톤에 맞게 작성해요.",
  fallbackCategory: "content",
  steps: [
    {
      id: "message-channel",
      title: "어떤 메시지를 작성할까요?",
      helper: "보낼 채널과 종류를 골라주세요.",
      fields: [
        {
          id: "channel",
          kind: "single-select-with-detail",
          label: "메시지 종류",
          allowCustom: true,
          options: [
            {
              id: "email",
              label: "이메일",
              detailLabel: "어떤 이메일인가요?",
              detailOptions: [
                { id: "outbound", label: "외부 영업·아웃리치" },
                { id: "inbound-reply", label: "문의 회신" },
                { id: "internal-notice", label: "사내 공지" },
                { id: "follow-up", label: "회의·미팅 후속" },
                { id: "thank-you", label: "감사·인사" },
              ],
            },
            { id: "kakao", label: "카카오톡·메신저" },
            { id: "slack", label: "슬랙·팀 메시지" },
            { id: "sms", label: "문자 (SMS/MMS)" },
            { id: "letter", label: "공식 서신·공문" },
          ],
        },
      ],
    },
    {
      id: "message-send-account",
      title: "어느 계정으로 보낼까요?",
      helper:
        "보낼 채널에 로그인이 필요해요. 처음이면 여기서 계정을 연결해 주세요. 초안만 받고 직접 보내실 거면 건너뛰셔도 돼요.",
      skippable: true,
      fields: [
        {
          id: "sendAccount",
          kind: "account-connect",
          label: "보내는 계정",
          helper:
            "예) Gmail 주소, 회사 메일(SMTP), Slack 워크스페이스, 카카오 비즈 채널, 발신 번호. 연결된 게 없으면 '계정 연결하기'를 눌러주세요.",
          optional: true,
        },
        {
          id: "sendMode",
          kind: "single-select",
          label: "발송 방식",
          options: [
            { id: "draft-only", label: "초안만 만들기 (직접 보냄)" },
            { id: "review-then-send", label: "확인 후 자동 발송" },
            { id: "schedule", label: "예약 발송" },
          ],
        },
      ],
    },
    {
      id: "message-recipient-address",
      title: "받는 곳을 알려주세요",
      helper:
        "이메일 주소·전화번호·Slack 채널 등 보낼 곳을 적어주세요. 여러 명이면 줄바꿈 또는 쉼표로 구분해주세요. 초안만 받으실 거면 건너뛰셔도 돼요.",
      skippable: true,
      fields: [
        {
          id: "recipientAddress",
          kind: "recipient-address",
          label: "받는 사람",
          placeholder:
            "이메일 주소, 전화번호(010-...), Slack #채널 또는 @사용자",
          optional: true,
        },
      ],
    },
    {
      id: "message-recipient",
      title: "누구에게 보내나요?",
      fields: [
        {
          id: "recipient",
          kind: "single-select",
          label: "받는 사람",
          allowCustom: true,
          options: [
            { id: "cold", label: "처음 연락하는 사람·콜드 아웃리치" },
            { id: "existing-customer", label: "기존 고객·거래처" },
            { id: "team", label: "사내 팀원" },
            { id: "executive", label: "임원·결정권자" },
            { id: "partner", label: "파트너사·외부 협력" },
            { id: "vendor", label: "벤더·공급사" },
            { id: "candidate", label: "구직자·면접 대상" },
          ],
        },
      ],
    },
    {
      id: "message-purpose",
      title: "어떤 목적인가요?",
      helper: "여러 개 골라도 좋아요.",
      fields: [
        {
          id: "purpose",
          kind: "multi-select",
          label: "목적",
          allowCustom: true,
          options: [
            { id: "request-meeting", label: "미팅 요청" },
            { id: "pitch", label: "제안·세일즈" },
            { id: "follow-up", label: "회의·미팅 후속" },
            { id: "announce", label: "안내·공지" },
            { id: "reply-inquiry", label: "문의 회신" },
            { id: "apology", label: "사과·이슈 대응" },
            { id: "thanks", label: "감사·인사" },
            { id: "remind", label: "리마인드·재요청" },
            { id: "negotiate", label: "협의·조율" },
          ],
        },
      ],
    },
    {
      id: "message-reference",
      title: "참고할 자료가 있나요?",
      helper: "이전에 보낸 좋은 메일이나 가이드 문서를 올려주시면 톤을 맞춰드려요.",
      skippable: true,
      fields: [
        {
          id: "reference",
          kind: "url-or-file",
          label: "참고 자료",
          optional: true,
        },
        {
          id: "attachments",
          kind: "file-with-role",
          label: "메시지에 첨부할 파일",
          helper: "예: 제안서.pdf → 본문에서 안내, 가격표.xlsx → 별첨",
          optional: true,
        },
      ],
    },
    {
      id: "message-tone",
      title: "말투와 길이",
      fields: [
        {
          id: "tone",
          kind: "single-select",
          label: "말투",
          options: [
            { id: "formal", label: "격식체·비즈니스" },
            { id: "polite", label: "공손한 경어" },
            { id: "friendly", label: "친근한 일상체" },
            { id: "firm", label: "단호하고 명확" },
            { id: "persuasive", label: "설득적·세일즈" },
          ],
        },
        {
          id: "length",
          kind: "single-select",
          label: "길이",
          options: [
            { id: "short", label: "짧게 (3~5줄)" },
            { id: "medium", label: "보통 (1~2문단)" },
            { id: "long", label: "길게 (3문단 이상·자세히)" },
          ],
        },
      ],
    },
    {
      id: "message-rules",
      title: "지키거나 피할 규칙이 있나요?",
      skippable: true,
      fields: [
        {
          id: "rules",
          kind: "multi-select",
          label: "제약",
          allowCustom: true,
          options: [
            { id: "no-price-commit", label: "가격·할인 직접 약속 금지" },
            { id: "no-promise", label: "확약·일정 단정 금지" },
            { id: "include-cta", label: "행동 유도(CTA) 한 줄 포함" },
            { id: "include-deadline", label: "회신 일정·마감 명시" },
            { id: "preserve-name", label: "이름·직책 정확히 표기" },
            { id: "include-attachment-note", label: "첨부 파일 안내 문구 포함" },
            { id: "no-emoji", label: "이모지 사용하지 않기" },
            { id: "no-other-brand", label: "타 브랜드 언급 금지" },
            { id: "include-signature", label: "서명·연락처 포함" },
          ],
        },
      ],
    },
  ],
};

const ERP_TEMPLATE: SkillTemplate = {
  kind: "erp",
  label: "ERP 연동",
  description: "ERP에서 데이터를 가져오거나 ERP에 데이터를 올리는 자동화를 만들어요.",
  fallbackCategory: "data",
  steps: [
    {
      id: "erp-system",
      title: "어떤 ERP를 쓰시나요?",
      helper: "사용 중인 ERP를 골라주세요. 없으면 직접 입력하실 수 있어요.",
      fields: [
        {
          id: "erpSystem",
          kind: "single-select",
          label: "ERP 시스템",
          allowCustom: true,
          options: [
            { id: "sap", label: "SAP" },
            { id: "sap-b1", label: "SAP Business One" },
            { id: "oracle-netsuite", label: "Oracle Netsuite" },
            { id: "duzon", label: "더존" },
            { id: "younglimwon", label: "영림원 K-System" },
            { id: "ecount", label: "이카운트" },
            { id: "custom-erp", label: "자체 개발 ERP" },
          ],
        },
      ],
    },
    {
      id: "erp-connection",
      title: "어떻게 연결할까요?",
      helper:
        "사용 중인 ERP 환경에 가장 가까운 방식을 골라주세요. 여러 방식을 섞어 쓸 수도 있어요.",
      fields: [
        {
          id: "connectionMode",
          kind: "single-select",
          label: "연결 방식",
          options: [
            {
              id: "api-key",
              label: "API 키로 연결",
              description:
                "ERP가 REST API를 제공하면 가장 빠르고 안정적입니다. 키와 도메인은 작업 실행 단계에서 안전하게 입력해요.",
            },
            {
              id: "login-automation",
              label: "로그인 자동화",
              description:
                "Rocky가 띄우는 브라우저로 사용자가 한 번 로그인하면 세션이 저장돼서 이후엔 자동 처리합니다. 캡차·2FA도 사용자 흐름 그대로.",
            },
            {
              id: "file-export",
              label: "엑셀·CSV 파일 주고받기",
              description:
                "ERP에서 받은 파일을 올리면 Rocky가 가공·정리하고, 필요하면 다시 올릴 형식으로 내보내요. 직접 통합이 어려운 ERP에 적합.",
            },
          ],
        },
      ],
    },
    {
      id: "erp-action",
      title: "어떤 작업을 하나요?",
      helper: "방향을 정해주세요. 가져온 데이터를 가공해서 다시 올리는 양방향도 가능해요.",
      fields: [
        {
          id: "action",
          kind: "single-select",
          label: "작업 방향",
          options: [
            { id: "extract", label: "데이터 가져오기 (조회·추출)" },
            { id: "upload", label: "데이터 올리기 (등록·수정)" },
            { id: "report", label: "리포트·요약 만들기" },
            {
              id: "round-trip",
              label: "양방향 (가져와서 가공한 뒤 다시 올리기)",
            },
          ],
        },
        {
          id: "dataKinds",
          kind: "multi-select",
          label: "다루는 데이터",
          allowCustom: true,
          options: [
            { id: "sales", label: "매출·매입" },
            { id: "inventory", label: "재고" },
            { id: "customers", label: "거래처·고객" },
            { id: "vendors", label: "공급사·협력사" },
            { id: "purchase-orders", label: "발주·구매 주문" },
            { id: "quotes", label: "견적·계약" },
            { id: "accounting", label: "회계 전표" },
            { id: "hr", label: "인사·근태" },
            { id: "products", label: "품목·SKU" },
          ],
        },
      ],
    },
    {
      id: "erp-notes",
      title: "추가로 알려주실 게 있나요?",
      helper:
        "ERP 화면 이름·메뉴 경로·특이한 양식·자주 쓰는 검색 조건처럼 자동화에 도움이 되는 메모를 남겨주세요.",
      skippable: true,
      fields: [
        {
          id: "notes",
          kind: "text",
          label: "메모",
          placeholder:
            "예: '거래처 → 신규 등록' 메뉴, 사업자번호 자동 형식 변환, 품목코드 앞 3자리는 카테고리",
          optional: true,
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
  research: RESEARCH_TEMPLATE,
  summary: SUMMARY_TEMPLATE,
  message: MESSAGE_TEMPLATE,
  erp: ERP_TEMPLATE,
};

export const SKILL_TEMPLATE_LIST: SkillTemplate[] = [
  DOCUMENT_TEMPLATE,
  CONTENT_TEMPLATE,
  DATA_TEMPLATE,
  TRANSLATION_TEMPLATE,
  RESEARCH_TEMPLATE,
  SUMMARY_TEMPLATE,
  MESSAGE_TEMPLATE,
  ERP_TEMPLATE,
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
