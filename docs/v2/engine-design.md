# Rocky v2 엔진 설계 — 얇은 하네스

- 상태: 제안 (Draft)
- 작성일: 2026-10-21
- 범위: Codex CLI 기반 런타임 제거, 자체 에이전트 루프(얇은 하네스) 도입, 핵심 기능(로키 / 에이전트 / 연결 설정)만 남기는 전면 재설계
- 같이 볼 것: [UX 컨셉과 디자인 시안](./ux-concept.md), [클릭 가능한 시안](./mockups/index.html)

---

## 0. 요약

### "가능할까?"에 대한 답

| 항목 | 답 | 한 줄 이유 |
| --- | --- | --- |
| Codex CLI를 걷어내고 자체 하네스로 교체 | **가능, 권장** | 지금 엔진의 대부분은 CLI 플래그 조립·이벤트 파싱·홈 디렉터리 복제다. LLM API를 직접 부르는 루프는 수천 줄이면 된다. |
| ChatGPT(Codex) 구독 연결 | **가능 (공식)** | OpenAI "Sign in with ChatGPT" 플랜 사용량 공유(2026-09 프리뷰). 사용자 OAuth 토큰으로 공개 `POST /v1/responses`를 부른다. Plus/Pro만 해당. 세부는 §3.4. |
| OpenAI / Anthropic API 키 | **가능** | 공식 API. 가장 안정적인 기본 경로. |
| Claude 구독(Pro/Max) 연결 | **자체 하네스에서는 불가** | Anthropic 정책이 서드파티 앱의 claude.ai 로그인 제공·구독 자격증명 경유·토큰 보관을 금지한다(2026-01부터 서버 차단). 대신 Max/Team 플랜의 월 API 크레딧 + API 키로 안내한다. 선택지는 §3.5. |
| 로컬/오픈 모델 (Ollama, LM Studio, vLLM, OpenRouter 등) | **가능** | 전부 OpenAI 호환 API로 붙는다. |

> 정책 내용은 2026-10-21 기준 웹 조사 결과다(출처는 §3.4·§3.5 끝). 구독 정책은 자주 바뀌므로 구현 직전에 다시 확인한다. 법률 자문이 아니다.

### 남기는 것 / 지우는 것

- **남김(개념)**: 로키(메인 에이전트), 에이전트(서브 에이전트), 연결 설정, 대화·작업 기록, 워크스페이스 파일, 앱 업데이트, Electron 셸
- **지움**: Codex/Claude Code/Ollama CLI 런타임, 스킬·스킬 템플릿·외부 스킬, 커넥터(Instagram/Threads/Facebook/Tistory), ECOUNT 연동, 메신저(Telegram), 즐겨찾기, CLI 로그인 기반 계정/인증 프로필
- 규모: `src/` 약 50.6k LOC 중 약 29~30k 삭제, 나머지 대부분도 재작성. 새 코어는 **약 5~6k LOC**를 목표로 한다.

---

## 1. 제품 모델 (새 도메인 언어)

기존 `CONTEXT.md`는 커넥터/ECOUNT/Instagram 용어집이다. v2에서는 아래 용어로 교체한다.

| 용어 | 정의 | 피할 말 |
| --- | --- | --- |
| **로키 (Rocky)** | 사용자가 만들지 않는 단 하나의 메인 에이전트. 사용자 지식을 관리하고, 일을 직접 하거나 에이전트에게 위임하고, 에이전트를 설계·특화하고, 사용자만 내릴 수 있는 결정만 올린다. | 코어 에이전트, rocky-core |
| **에이전트** | 특정 분야를 맡는 서브 에이전트. 로키가 제안해 만들 수도, 사용자가 직접 만들 수도 있다. | 워커, 직원(UI 문구로는 "팀원" 허용) |
| **키우기 방식** | 에이전트의 특화를 누가 주도하는지. `로키와 함께`(로키가 개선안을 제안) 또는 `직접`(사용자만 수정, 로키는 요청받을 때만 제안). | |
| **지침** | 에이전트의 역할·말투·작업 원칙을 담은 시스템 프롬프트 본문. 기존 `soul`을 대체한다. | soul, 페르소나 |
| **업무** | 사용자가 로키에게 넘긴 반복/지속 작업 단위. 무엇을, 언제, 어떤 결과물로, 어떤 기준으로 할지를 담는다. 담당 에이전트와 위임 단계를 가진다. | 태스크, 스킬 |
| **위임 단계** | 업무 하나에 대해 사용자가 얼마나 맡기는지. `0 함께 하기 → 1 초안까지 → 2 하고 보고 → 3 맡기기`. | 자동화 레벨 |
| **결정** | AI가 스스로 내릴 수 없어 사용자에게 올라온 질문·승인·제안. 결정함에 쌓인다. | 알림, 승인 요청(JSON) |
| **위임** | 로키(또는 에이전트)가 다른 에이전트에게 작업을 넘기는 행위. 자식 세션 하나를 만든다. | 디스패치, 핸드오프 |
| **지식** | 사용자에 대해 로키가 알고 있는 것(나, 사람, 프로젝트, 선호, 규칙). 로컬 Markdown 파일. | 메모리(내부 구현 용어로만) |
| **연결** | 모델 공급자에 대한 인증 하나. ChatGPT 구독, OpenAI API, Anthropic API, 로컬 서버 등. | 계정, 인증 프로필 |
| **도구** | 에이전트가 호출할 수 있는 함수(파일 읽기/쓰기, 셸, 웹 가져오기, 위임 등). 위험 등급을 가진다. | 스킬, capability |

### 관계

- 로키는 정확히 하나다. 에이전트는 0개 이상이다.
- 에이전트는 하나의 지침, 도구 목록, 모델 지정, 지식 범위, 워크스페이스를 가진다. 이들의 묶음은 **버전**으로 기록된다.
- 업무는 담당 에이전트 하나(또는 로키 자신)와 위임 단계 하나를 가진다.
- 결정은 항상 출처(에이전트, 세션, 도구 호출)를 가진다. 에이전트의 질문은 **로키를 먼저 거친다**. 로키가 지식으로 답할 수 있으면 대신 답하고, 못하면 사용자에게 결정으로 올린다.
- 사용자가 결정에 답하면 로키는 그 답을 **규칙**으로 지식에 남길지 제안한다. ("다음부터 이런 건 묻지 않고 A로 할까요?")
- 위임 단계는 기록이 쌓이면 로키가 올리자고 제안하고, 사용자가 승인해야만 오른다. 내리는 것은 언제든 즉시 가능하다.

### 위임 단계 정의

| 단계 | 이름 | 에이전트가 하는 일 | 사용자에게 올라오는 것 |
| --- | --- | --- | --- |
| 0 | 함께 하기 | 사용자가 하는 방식을 관찰·질문하고 절차를 업무 카드로 정리 | 절차 확인 질문 |
| 1 | 초안까지 | 결과물을 만들되 외부로 나가는 행동은 하지 않음 | 매번 검토·승인 |
| 2 | 하고 보고 | 정해진 범위 안에서 실행 후 결과 보고 | 보고(참고) + 범위 밖 판단 |
| 3 | 맡기기 | 자율 실행 | 예외·실패만 |

승격 제안 기준(초기값): 같은 업무에서 **연속 5회** 수정 없이 승인되면 다음 단계 제안. 사용자가 결과를 수정하면 카운트는 0으로 돌아간다.

---

## 2. 아키텍처 개요

```
┌──────────────────────── Electron (유지) ────────────────────────┐
│  web/ (React SPA)  ──HTTP / SSE──▶  Rocky Core (Node, 같은 프로세스 트리) │
└──────────────────────────────────────────────────────────────────┘

Rocky Core (src/)
├─ rocky/      로키: 오케스트레이션, 결정 에스컬레이션, 업무·위임 단계, 특화 제안
├─ harness/    에이전트 루프: 턴 반복, 도구 실행, 권한 게이트, 스티어링, 컴팩션
├─ llm/        모델 계층: 공급자 어댑터 3종 + 인증(API 키, OAuth) + 모델 카탈로그
├─ tools/      기본 도구 + 로키 전용 메타 도구
├─ store/      세션 JSONL, 에이전트, 업무, 결정, 지식, 자격증명
├─ api/        Fastify HTTP + SSE (헬퍼는 기존 것 재사용)
└─ (유지) installer/ release/ system/ cli/
```

원칙:

1. **루프는 하나, 공급자는 어댑터.** 로키와 모든 에이전트는 같은 `runAgent()`를 쓴다. 차이는 지침·도구·모델·지식 범위뿐이다.
2. **Rocky가 대화 상태를 소유한다.** 지금은 대화 맥락이 CLI 스레드 안에 있고 `transcript.jsonl`은 표시용 사본이다. v2에서는 세션 JSONL이 곧 모델 컨텍스트다. 모델을 바꿔도 대화가 이어진다.
3. **도구 호출은 1급 이벤트.** 웹이 `run.raw`의 `command_execution`을 뒤지는 구조를 없앤다.
4. **권한은 하네스가 판단한다.** 프롬프트에 `<runtime_policy>`를 끼워 넣거나 셸 명령을 정규식으로 분류하던 방식은 사라진다. 도구마다 위험 등급이 있고, 에이전트 정책 + 업무 위임 단계로 허용/질문/거부가 결정된다.
5. **로컬 우선.** 모든 상태는 사용자 기기의 파일이다. DB를 두지 않는다.

---

## 3. 모델 계층 (`src/llm/`)

pi의 `pi-ai`와 같은 역할이다. 인터페이스는 우리 것으로 정의하고, 구현은 직접 작성한다. 필요하면 이 경계 뒤에 pi 패키지를 그대로 꽂을 수 있게 모양을 맞춘다.

> pi는 `badlogic/pi-mono`에서 `earendil-works/pi`(MIT)로 옮겨졌고, npm 패키지도 `@mariozechner/*`(0.73.1에서 지원 중단)에서 `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`(1.3.0)로 바뀌었다. pi-ai를 쓰게 되면 `builtinModels()`로 전부 등록하지 말고 허용한 공급자만 하나씩 등록한다. pi-ai에는 Claude 구독 OAuth 흐름이 들어 있는데, Rocky는 이걸 노출하면 안 된다(§3.5).

pi에서 가져올 설계 아이디어:

1. 와이어 형식 / 공급자 / 모델을 분리한다. OpenAI 호환 서버는 "호환 플래그가 붙은 공급자 설정"일 뿐이다.
2. 정규화된 이벤트 스트림 하나. 델타는 `contentIndex`로 구분한다(텍스트·도구 호출 델타가 섞여 올 수 있다).
3. 모델·컨텍스트를 직렬화 가능한 데이터로 두고, 세션은 JSONL 트리로 저장한다.
4. 공급자가 자기 OAuth를 소유하고, UI와는 "상호작용 프로토콜"(브라우저 열기, 코드 붙여넣기, 진행 알림)로만 대화한다. 자격증명 저장소는 잠금을 걸고 갱신해서 동시에 두 번 refresh하지 않게 한다.
5. `transformContext`(지식 주입 등)와 `convertToLlm`(UI 전용 메시지 제거)을 분리한다.
6. 모델을 바꾸면 이전 모델의 thinking 블록은 버린다.
7. 테스트는 가짜 공급자로 한다.

pi와 다르게 가는 점: pi는 권한 프롬프트 없이 컨테이너에서 돌리는 철학이지만, Rocky는 개인 비서라서 **도구 호출 전 권한 게이트(`beforeToolCall`에 해당)가 필수**다. 서브 에이전트도 pi에는 없지만 Rocky의 핵심 기능이다.

### 3.1 핵심 타입

```ts
// 와이어 형식. 공급자가 아니라 "어떻게 말하는지"로 나눈다.
type WireApi =
  | "openai-responses"     // OpenAI API, ChatGPT(Codex) 구독
  | "anthropic-messages"   // Anthropic API
  | "openai-completions";  // Ollama, LM Studio, vLLM, OpenRouter, Groq, DeepSeek, 기타 호환 서버

interface ModelInfo {
  ref: string;               // "<connectionId>/<modelId>"
  connectionId: string;
  id: string;                // 공급자 모델 id
  label: string;
  wire: WireApi;
  baseUrl: string;
  contextWindow: number;
  maxOutputTokens: number;
  supports: { tools: boolean; reasoning: boolean; images: boolean };
  local: boolean;            // 기기 밖으로 데이터가 나가지 않음
  tier: "deep" | "balanced" | "fast";  // 로키의 모델 추천용 등급
}

type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface AssistantMessage {
  role: "assistant";
  content: Array<TextPart | ThinkingPart | ToolCallPart>;
  modelRef: string;
  usage: Usage;
  stopReason: "stop" | "length" | "tool_use" | "error" | "aborted";
  errorMessage?: string;
}

interface LlmContext {
  system: string;
  messages: Message[];
  tools: ToolSpec[];          // { name, description, parameters: JSONSchema }
}

type LlmEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolcall_start"; id: string; name: string }
  | { type: "toolcall_delta"; id: string; delta: string }
  | { type: "toolcall_end"; call: ToolCallPart }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: AssistantMessage };

interface LlmClient {
  stream(model: ModelInfo, ctx: LlmContext, opts: StreamOptions): AsyncIterable<LlmEvent>;
}
```

- 메시지 형식은 공급자 중립이다. 어댑터가 요청 직전에 각 와이어 형식으로 변환한다. 그래서 대화 도중 모델을 바꿔도(예: Claude → 로컬 Qwen) 같은 기록으로 이어 갈 수 있다. 다른 공급자의 thinking 블록은 텍스트로 낮춰서 넘긴다.
- 어댑터는 `fetch` + SSE 파서로 직접 구현한다. 공식 SDK를 쓰지 않으면 의존성이 작아지고, Codex 백엔드처럼 헤더가 특수한 경우를 다루기 쉽다.
- 사용량(`usage`)은 모든 응답에서 정규화한다. 구독 연결은 비용 대신 남은 한도를 보여 준다(§3.4).

### 3.2 연결 (Connection)

```ts
type ConnectionKind =
  | "chatgpt-subscription"   // OAuth
  | "openai-api"             // API 키
  | "anthropic-api"          // API 키
  | "openai-compatible";     // baseUrl + (선택) API 키. 로컬 서버 포함

interface Connection {
  id: string;
  kind: ConnectionKind;
  label: string;             // "내 ChatGPT Pro", "집 Ollama"
  baseUrl?: string;
  local: boolean;
  status: "ready" | "needs_login" | "error";
  lastCheckedAt?: string;
}
```

- 비밀값(API 키, 액세스/리프레시 토큰)은 `connections.json`에 넣지 않는다. Electron `safeStorage`로 암호화해 `credentials/`에 저장하고, 백엔드는 시작 시 Electron 메인 프로세스에서 복호화된 값을 받는다(웹 UI는 절대 비밀값을 받지 않는다).
- 로컬 서버 자동 탐지: `127.0.0.1:11434`(Ollama), `127.0.0.1:1234`(LM Studio)의 `/v1/models`를 확인해 "연결 추가" 후보로 보여 준다.
- 로컬 모델은 `supports.tools`를 확인한다. 도구 호출이 안 되는 모델은 "대화 전용"으로 표시하고, 도구가 필요한 에이전트에는 고를 수 없게 한다.

### 3.3 와이어 어댑터 3종

| 어댑터 | 대상 | 비고 |
| --- | --- | --- |
| `openai-responses` | OpenAI API, ChatGPT 구독 | 같은 코드에 baseUrl·인증 헤더만 다르게 |
| `anthropic-messages` | Anthropic API | 프롬프트 캐싱(`cache_control`)을 시스템 프롬프트와 마지막 사용자 메시지에 적용 |
| `openai-completions` | 그 외 전부 | 공급자별 차이(`reasoning_content`, tool_call 인덱스 등)는 작은 호환 플래그로 처리 |

Gemini는 OpenAI 호환 엔드포인트로 먼저 붙이고, 필요해지면 전용 어댑터를 추가한다.

### 3.4 ChatGPT(Codex) 구독 — Sign in with ChatGPT

OpenAI가 서드파티 하네스에서 ChatGPT 플랜 사용량을 쓰는 공식 경로("Sign in with ChatGPT", 플랜 사용량 공유)를 2026-09 말부터 프리뷰로 열었다. pi, OpenCode 등이 오픈소스 파트너로 올라가 있다. Rocky는 이 경로를 쓴다.

**자격 조건**: 지금 바로 쓸 수 있는 대상은 오픈소스 프로젝트, 로컬에서 도는 개인 프로젝트, 선정된 비공개 앱이다. 유료·원격 호스팅 앱은 신청서(대기열)를 거친다. Rocky 저장소는 공개지만 `LICENSE` 파일이 없고 `package.json`이 `"private": true`다. **MIT나 Apache-2.0 라이선스를 추가하면 오픈소스 범주가 분명해진다**(§11 열린 결정).

**흐름** (Electron 메인 프로세스가 담당, 웹 UI는 토큰을 보지 않는다):

1. 첫 로그인 때 동적 클라이언트 등록: `https://auth.openai.com/api/accounts/authorize`에 `client_id=dynamic_agent_client`, `agent_name_hint=Rocky`, 설치마다 고정인 `ext_agent_host_id`(`urn:uuid:…`)를 보낸다. 콜백으로 받은 `client_id`(`oaiapp_…`)를 저장해 이후 재사용한다.
2. 리다이렉트는 `http://127.0.0.1:<port>/auth/callback`(`localhost` 금지, 포트만 바뀔 수 있음). PKCE S256 + 매번 새 `state`/`nonce`.
3. 스코프 `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`. ID 토큰을 JWKS로 검증하고, 부여된 스코프에 `chatgpt.tokens.use.direct`가 있는지 확인한다.
4. 토큰 엔드포인트 `https://auth.openai.com/api/accounts/oauth/token`(폼 인코딩, 시크릿 없음). refresh 토큰은 회전하므로 액세스/리프레시를 항상 함께 교체한다.
5. 추론: `POST https://api.openai.com/v1/responses`, `Authorization: Bearer <access>`, `store:false`, `stream:true`, 매번 전체 기록 전송. 시스템 지시는 `instructions`로 보낸다(`role:"system"` 항목 거부). `previous_response_id`, `temperature`, `top_p` 등은 보내지 않는다.
6. 모델 목록: `GET /v1/models`에서 `visibility=="list"`만.
7. 한도 오류 `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable`는 스트림 도중에도 올 수 있다 → 런을 `error`로 끝내고 "구독 한도 도달, 다른 연결로 이어갈까요?" 결정을 띄운다.

**지원 범위**: 함수 도구, 이미지·파일 입력은 된다. 호스팅 도구(이미지 생성, 코드 인터프리터 등)와 오디오·비디오 입력은 안 된다. Rocky는 자체 도구만 쓰므로 문제없다. 사용량은 사용자의 ChatGPT 플랜 한도에서 차감되고, 사용자는 ChatGPT 설정에서 앱별 주간 상한(10~100%)을 걸거나 연결을 끊을 수 있다.

**쓰지 않는 것**: Codex CLI의 OAuth 클라이언트 ID를 재사용해 `chatgpt.com/backend-api/codex/responses`를 부르는 기존 방식(pi의 "OpenAI Codex (legacy)"). 지금도 동작하지만 OpenAI는 새 경로로 옮기라고 권하고, SIWC 문서는 `backend-api` 사용을 금한다. Codex `app-server`/SDK를 임베드하는 방법도 있지만 그건 Codex의 루프를 쓰는 것이라 이번 목적(자체 하네스)과 맞지 않는다.

출처: developers.openai.com/siwc (quickstart, token-sharing-open-source, models-and-inference, preview-limitations), learn.chatgpt.com/docs/sign-in-with-chatgpt, github.com/earendil-works/pi `packages/ai` CHANGELOG(0.99.0). OpenAI 이용약관 페이지는 조사 중 403으로 직접 확인하지 못했다.

### 3.5 Claude 구독

**결론: Rocky의 자체 하네스에서 Claude Pro/Max 구독 토큰은 쓰지 않는다.**

- Claude Code 법률·준수 페이지는 서드파티 개발자가 ① 자기 앱에 Claude.ai 로그인을 제공하는 것, ② 사용자를 대신해 Free/Pro/Max 자격증명으로 요청을 보내는 것, ③ Claude.ai 자격증명·세션 토큰을 수집·저장·중계하는 것을 금지한다.
- Agent SDK 문서도 "사전 승인 없이는 서드파티가 claude.ai 로그인이나 구독 한도를 제공할 수 없다"고 명시한다. 소비자 약관은 API 키 외의 자동화 접근을 금지한다.
- 2026-01-09부터 서버에서 Claude Code 위장 하네스를 차단하고 있고, 계정 정지 사례도 보고됐다.
- 그러니 `~/.claude/.credentials.json`이나 `CLAUDE_CODE_OAUTH_TOKEN`을 읽는 것도 하지 않는다. (현재 `claude-status-service.ts`가 이 파일을 읽어 사용량을 조회하는데, v2에서 삭제된다.)

**대신 제공하는 것**:

| 경로 | 위험 | 설명 |
| --- | --- | --- |
| Anthropic API 키 | 없음 | 기본 경로. 연결 화면에서 "Max/Team 플랜이면 매달 API 크레딧이 포함돼요(Max 5x $100, Max 20x $200, Team 최대 $500)"라고 안내하고, Console 조직 연결 → 키 발급 방법을 보여 준다. Pro·Free 플랜은 크레딧이 없다. |
| Bedrock / Vertex | 없음 | 회사 클라우드 계정이 있는 사용자용. 후순위. |
| 내 컴퓨터의 Claude Code에 맡기기 (선택, 실험) | 회색(중간~낮음) | 사용자가 직접 설치하고 자기 터미널에서 로그인한 **수정하지 않은** `claude` 바이너리를 "외부 작업자"로 실행(`claude -p`). Rocky는 로그인 UI를 띄우지 않고 자격증명도 만지지 않는다. 법률 페이지가 "최종 사용자가 수정하지 않은 Claude Code 바이너리에 자기 구독으로 로그인하는 것"은 막지 않는다고 하지만, 제품에 Claude Code를 넣으려면 Commercial Terms 동의가 필요하고 Agent SDK 문서 문구와 충돌한다. 이 경로는 Rocky 루프가 아니라 Claude Code 루프로 돈다(Rocky 도구는 MCP로 노출). 배포 전 Anthropic의 서면 확인을 받는 것이 안전하다. 기능 이름에 "Claude Code"를 쓰지 않는다. |

권장: v2 첫 출시는 **API 키만** 지원하고, "Claude Code에 맡기기"는 M7 이후 별도 판단(§11).

출처: code.claude.com/docs/en/legal-and-compliance, code.claude.com/docs/en/agent-sdk/overview, anthropic.com/legal/consumer-terms, platform.claude.com/docs/en/about-claude/api-credits-for-subscribers, support.claude.com/en/articles/15036540. 구독 사용량이 서드파티 앱에서 어떻게 과금되는지(추가 사용량 vs 플랜 한도)는 공지 간 표현이 엇갈려 확정하지 못했다.

### 3.6 그 밖의 공급자 메모

| 공급자 | 주소 | 주의 |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | 도구 호출 가능, `tool_choice` 미지원. 컨텍스트 길이는 Modelfile `num_ctx`로만. |
| LM Studio | `http://127.0.0.1:1234/v1` | Chat Completions·Responses 지원. |
| vLLM | 사용자 지정 | 도구 호출에 `--enable-auto-tool-choice --tool-call-parser` 필요. |
| OpenRouter | `https://openrouter.ai/api/v1` | API 키 또는 OAuth PKCE(사용자 소유 키 발급, 로컬 콜백 가능). |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI 호환 엔드포인트는 베타. Gemini CLI/Antigravity OAuth는 쓰지 않는다(2026-02부터 대량 정지 보고). |
| GitHub Copilot | — | VS Code 클라이언트 위장 방식은 쓰지 않는다. |

### 3.7 모델 추천 (로키가 고르는 방식)

에이전트의 모델 지정은 두 가지다.

- **고정**: `modelRef` 하나 + 선택적 대체 모델
- **로키에게 맡김**: 등급(`deep` / `balanced` / `fast`)과 제약(`localOnly`)만 정하면 로키가 연결된 모델 중에서 고른다

로키는 에이전트를 만들거나 특화할 때 다음을 근거로 추천한다: 작업 성격(코딩·분석은 deep, 분류·요약은 fast), 다루는 지식의 민감도(민감하면 `localOnly` 제안), 도구 필요 여부, 사용 가능한 구독 한도. 추천은 항상 이유와 함께 결정 카드로 보여 준다.

---

## 4. 하네스 (`src/harness/`)

pi-mono의 `pi-agent-core`와 같은 역할이다. 목표 크기 600줄 안팎.

### 4.1 도구 인터페이스

```ts
type ToolRisk = "read" | "write" | "exec" | "external";

interface AgentTool<A = unknown> {
  name: string;
  label: string;                  // UI 표시용 한국어 이름
  description: string;            // 모델에게 주는 설명
  parameters: JSONSchema;         // zod → JSON Schema
  risk: ToolRisk;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  signal: AbortSignal;
  agentId: string;
  sessionId: string;
  workspaceRoot: string;
  onUpdate(partial: ToolResult): void;   // 긴 셸 출력 스트리밍 등
}

interface ToolResult {
  content: Array<TextPart | ImagePart>;  // 모델에게 돌아가는 것
  summary?: string;                      // UI 한 줄 요약
  artifacts?: ArtifactRef[];             // 만들어진 파일
  isError?: boolean;
}
```

### 4.2 루프

```ts
async function* runAgent(input: RunInput): AsyncIterable<AgentEvent> {
  const { session, agent, model, tools, signal } = input;
  yield { type: "run.start", ... };

  while (!signal.aborted) {
    const ctx = await buildContext(session, agent);   // 세션 JSONL → 메시지, 컴팩션 반영
    const assistant = yield* streamAssistant(model, ctx, signal);
    await session.append(assistant);

    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") break;

    const calls = toolCalls(assistant);
    if (calls.length === 0) {
      const followUp = input.queue.takeFollowUp();      // 응답 중 들어온 사용자 메시지
      if (followUp) { await session.append(followUp); continue; }
      break;
    }

    // 읽기 등급은 병렬, 나머지는 순서대로
    for await (const result of executeTools(calls, input)) {
      await session.append(result);
    }

    const steer = input.queue.takeSteering();          // "아 그거 말고 이렇게" 끼어들기
    if (steer) await session.append(steer);
  }

  yield { type: "run.end", status: ... };
}
```

- **권한 게이트**: `executeTools` 안에서 `policy.check(tool, args, agent, duty)` → `allow | ask | deny`. `ask`이면 결정(kind `permission`)을 만들고, 그 도구 호출만 대기한다. 사용자가 답하면 이어서 실행하거나 거부 메시지를 도구 결과로 돌려준다.
- **대기 중 재시작**: 결정을 기다리는 런은 상태 `waiting`으로 저장된다. 앱을 껐다 켜도 결정이 풀리면 세션 JSONL에서 컨텍스트를 다시 만들어 이어 간다. (CLI 스레드 의존이 없어서 가능해진다.)
- **스티어링 / 후속 메시지**: 실행 중에 사용자가 보낸 메시지는 큐에 들어간다. 도구 실행 사이에 끼워 넣는 것(steering)과 끝난 뒤 이어 보내는 것(follow-up)을 구분한다.
- **컴팩션**: 컨텍스트가 모델 창의 80%를 넘으면 오래된 구간을 요약해 `compaction` 항목으로 바꾼다. 요약은 같은 연결의 `fast` 등급 모델로 만든다.
- **중단**: `AbortSignal` 하나로 LLM 스트림과 실행 중인 도구(셸 프로세스 포함)를 함께 끊는다.

### 4.3 에이전트 이벤트 (SSE로 나가는 것)

| 이벤트 | 주요 필드 |
| --- | --- |
| `run.start` | runId, sessionId, agentId, parentRunId? |
| `message.start` / `message.delta` / `message.end` | messageId, kind(`text`/`thinking`), delta / message |
| `tool.start` / `tool.update` / `tool.end` | toolCallId, name, label, args, risk / partial / result.summary, isError, artifacts |
| `delegation.start` / `delegation.end` | childRunId, childSessionId, agentId, brief / status, summary |
| `decision.request` / `decision.resolve` | decisionId, blocking / answer |
| `usage` | input, output, cacheRead, cost 또는 한도 |
| `run.end` | status(`done`/`error`/`aborted`/`waiting`), error? |

- 자식 런(위임)의 이벤트도 같은 스트림으로 흘려보내되 `parentRunId`를 붙인다. 웹은 이걸로 로키 대화 안에 위임 카드를 접어서 보여 준다.
- SSE에 `id:`를 붙이고 `Last-Event-ID` 재연결을 지원한다. 15초마다 하트비트를 보낸다. (지금은 둘 다 없다.)

---

## 5. 도구 (`src/tools/`)

### 5.1 기본 도구 (모든 에이전트가 고를 수 있음)

| 도구 | 위험 | 설명 |
| --- | --- | --- |
| `read_file` | read | 워크스페이스 + 허용 폴더 안의 파일 읽기 (텍스트, 이미지) |
| `list_files` | read | 폴더 목록 / glob |
| `search_files` | read | 내용 검색 |
| `write_file` | write | 새 파일 쓰기 / 덮어쓰기 |
| `edit_file` | write | 정확한 문자열 치환 |
| `shell` | exec | macOS는 bash, Windows는 PowerShell. cwd는 워크스페이스 |
| `web_fetch` | read | URL 가져와 본문을 Markdown으로 |

- 파일 도구의 경로는 워크스페이스와 사용자가 명시적으로 허용한 폴더 안으로 제한한다(기존 `ensureWorkspacePath`의 경로 격리 로직 재사용).
- 만들어지거나 바뀐 파일은 기존 스냅샷-비교 로직으로 아티팩트로 잡는다.
- `external` 등급(메일 보내기, 게시 등)은 v2 초기에는 기본 도구에 없다. 연동을 다시 붙일 때 이 등급으로 들어온다.

### 5.2 로키 전용 메타 도구

| 도구 | 설명 |
| --- | --- |
| `delegate` | 에이전트에게 작업 위임. `{agentId, brief, deliverable, background?}` |
| `delegation_status` | 백그라운드 위임의 진행/결과 확인 |
| `ask_user` | 사용자에게 결정 올리기. `{title, why, options[], recommended?, blocking}` |
| `recall` / `remember` | 지식 검색 / 기록 (기록은 위임 단계에 따라 바로 쓰거나 결정으로 제안) |
| `propose_agent` | 새 에이전트 설계안 제안 (지침, 도구, 모델, 이유) |
| `propose_agent_change` | 기존 에이전트 개선안 제안 (버전 diff) |
| `upsert_duty` | 업무 카드 만들기/고치기 |

서브 에이전트에게도 `ask_user`가 있지만, 서브 에이전트의 `ask_user`는 사용자에게 바로 가지 않고 **로키에게 먼저 간다**(§6.3).

---

## 6. 로키 (`src/rocky/`)

### 6.1 로키는 "특별한 지침을 가진 에이전트"

로키는 `agents/rocky/`에 저장되는 예약 에이전트다. 별도 엔진이 아니다. 차이는:

- 시스템 프롬프트 = 로키 지침 + **지식 색인**(파일 목록과 한 줄 설명) + 팀 명단(에이전트 이름·역할·모델) + 진행 중인 업무와 대기 중인 결정 요약
- 도구 = 기본 도구 + 메타 도구
- 삭제·이름 변경 불가. 모델은 사용자가 바꿀 수 있다.

지금처럼 키워드/정규식으로 스킬을 고르는 라우팅(`rocky-skill-registry`)은 없앤다. 무엇을 직접 하고 무엇을 위임할지는 로키가 도구 호출로 판단한다.

### 6.2 위임

```
사용자 ─▶ 로키 세션
           └─ delegate(researcher, "경쟁사 3곳 가격표 정리", deliverable="표")
                └─ 자식 세션 (researcher 지침·도구·모델)
                     └─ runAgent() … 결과 요약 + 아티팩트
           ◀─ 도구 결과: { summary, artifacts, raisedDecisions }
```

- 위임 = 자식 세션 하나. 자식 세션 JSONL 헤더에 `parentSessionId`, `parentToolCallId`.
- 여러 `delegate`를 한 턴에 부르면 병렬로 돈다.
- `background: true`면 도구는 바로 "접수됨"을 돌려주고, 끝나면 로키 세션에 후속 메시지("리서치가 끝났어요")가 들어와 로키가 이어서 정리한다. 사용자는 기다리지 않고 다른 대화를 할 수 있다. 진짜 비서처럼 "맡겨 두고 나중에 보고 받는" 감각의 핵심이다.
- 로키는 자식 결과를 그대로 붙이지 않고 요약·검토해서 전달한다.

### 6.3 결정 에스컬레이션

"AI가 할 수 없는 결정만 사용자에게"를 구조로 보장한다.

```
에이전트 ask_user(질문)
   └─▶ 로키: 지식·규칙·업무 카드로 답할 수 있나?
         ├─ 예  → 대신 답함 (활동 기록에 "로키가 대신 답함" 남김, 사용자는 나중에 볼 수 있음)
         └─ 아니오 → 결정 생성 → 결정함
                       └─ 사용자 답 → 원래 도구 호출로 반환
                                  └─ 로키: "다음부터 이런 건 A로 할까요?" 규칙화 제안
```

```ts
interface Decision {
  id: string;
  kind: "question" | "approval" | "permission" | "proposal";
  title: string;                 // 한 문장
  why: string;                   // 왜 AI가 정할 수 없는지
  options: { id: string; label: string; detail?: string }[];
  recommendedOptionId?: string;  // 로키 추천
  allowFreeText: boolean;
  blocking: boolean;             // 작업이 멈춰 있는지
  source: { agentId: string; sessionId: string; toolCallId?: string; dutyId?: string };
  status: "pending" | "resolved" | "dismissed";
  answer?: { optionId?: string; text?: string; by: "user" | "rocky" };
  createdAt: string;
  resolvedAt?: string;
}
```

결정함 노출 규칙:

- 사용자에게 올라오는 것은 **결정 필요**와 **보고(참고)** 두 종류뿐이다.
- 결정 필요는 막고 있는 작업이 있는 것(`blocking`)부터 정렬한다.
- 모든 결정에는 로키 추천과 이유가 붙는다. 사용자는 대부분 "추천대로"를 누르면 된다.

### 6.4 업무 인수인계

"진짜 비서를 고용해서 하나씩 넘겨주는" 흐름이다.

1. 사용자가 "이 일 넘기고 싶어"라고 하거나, 로키가 대화 기록에서 반복 작업을 발견해 제안한다.
2. 로키가 짧은 인터뷰를 한다: 무엇을 / 언제(수동·일정·조건) / 결과물 / 잘했다의 기준 / 하면 안 되는 것 / 참고 자료.
3. 결과로 **업무 카드**를 만든다. 담당은 기존 에이전트, 새 에이전트(설계안 제안), 또는 로키 자신.
4. 위임 단계 0 또는 1로 시작한다. 첫 실행은 항상 사용자 검토를 받는다.
5. 실행 기록(승인/수정/거절)이 쌓이면 로키가 단계를 올리자고 제안한다.

```ts
interface Duty {
  id: string;
  title: string;
  brief: string;                 // 인터뷰로 정리된 Markdown (무엇/결과물/기준/금지)
  ownerAgentId: string;          // "rocky" 가능
  trustLevel: 0 | 1 | 2 | 3;
  trigger: { kind: "manual" } | { kind: "schedule"; cron: string } ;
  scope: { tools: string[]; folders: string[] };   // 단계 2 이상에서 허용 범위
  stats: { runs: number; approvedStreak: number; lastRunAt?: string };
}
```

기존 `tasks/`(스케줄러·웹훅)는 업무의 `trigger` 실행기로 흡수한다. 메신저 전달 필드는 지운다.

### 6.5 특화 (에이전트 키우기)

- 에이전트 설정(지침, 도구, 모델, 지식 범위)은 **버전**으로 저장된다. 모든 변경은 diff와 사유를 남긴다. 되돌리기 가능.
- `로키와 함께` 방식: 로키가 실행 기록·사용자 수정·결정 답변을 보고 `propose_agent_change`로 개선안을 낸다. 결정(kind `proposal`)으로 올라오고, 승인하면 새 버전이 된다.
- `직접` 방식: 사용자가 에이전트 화면에서 직접 고친다. 로키는 먼저 제안하지 않고, 사용자가 "로키 의견 듣기"를 누를 때만 제안한다.
- 방식은 에이전트마다 언제든 바꿀 수 있다.

### 6.6 지식

- 위치: `knowledge/` 아래 Markdown. `INDEX.md`에 파일별 한 줄 설명.
- 기본 파일: `me.md`(나), `preferences.md`(선호·규칙), `people/`, `projects/`.
- 로키 시스템 프롬프트에는 색인만 넣고, 본문은 `recall`로 필요할 때 읽는다.
- 에이전트에는 지식 범위(파일 목록)를 정해서 그 부분만 보이게 한다. 기본값은 없음.
- `localOnly` 표시가 된 지식 파일은 로컬 모델 에이전트에게만 보인다.
- 처음에는 파일 검색으로 충분하다. 임베딩 검색은 필요해질 때 추가한다.

---

## 7. 저장소 (`src/store/`)

```
<stateRoot>/
├─ schema.json                    { "version": 2 }
├─ connections.json               연결 메타데이터 (비밀값 없음)
├─ credentials/                   safeStorage로 암호화된 비밀값
├─ knowledge/
│  ├─ INDEX.md  me.md  preferences.md
│  ├─ people/*.md
│  └─ projects/*.md
├─ agents/
│  ├─ rocky/                      로키 (예약)
│  └─ <agentId>/
│     ├─ agent.json               현재 설정 + 버전 번호
│     ├─ versions/<n>.json        설정 이력 (diff, 사유, 누가)
│     ├─ workspace/               작업 폴더
│     └─ sessions/<sessionId>.jsonl
├─ duties/<dutyId>.json
├─ decisions/<decisionId>.json
└─ runs/<runId>.json              런 상태 (running/waiting/done/error), 인스펙터용 요약
```

`stateRoot` 결정 로직(Electron: `%LOCALAPPDATA%\Rocky\state`, macOS `~/Library/Application Support/Rocky/agent-engine`, `ROCKY_STATE_ROOT`)은 그대로 쓴다.

### 7.1 세션 JSONL (트리)

pi처럼 항목마다 `id`/`parentId`를 둬서 "다시 시도", "여기서 갈라지기"를 파일 하나에서 표현한다.

```ts
type SessionEntry =
  | { type: "header"; id: string; version: 2; agentId: string; createdAt: string;
      parentSessionId?: string; parentToolCallId?: string; dutyId?: string; title?: string }
  | { type: "message"; id: string; parentId: string; message: Message; at: string }
  | { type: "compaction"; id: string; parentId: string; summary: string; firstKeptId: string }
  | { type: "model_change"; id: string; parentId: string; modelRef: string }
  | { type: "decision"; id: string; parentId: string; decisionId: string };
```

컨텍스트 = 현재 잎에서 루트까지 거슬러 올라가며 메시지를 모으고, 컴팩션이 있으면 그 지점부터 요약으로 대체.

### 7.2 기존 데이터

첫 실행에서 v1 레이아웃을 발견하면 기존 폴더를 `<stateRoot>/legacy-v1/`로 옮기고, v1 에이전트의 `name`, `description`, `soul`(→ 지침), `color`만 가져온다. v1 세션은 Codex 스레드 상태에 의존하므로 이어 쓸 수 없다. 읽기 전용 보관만 한다.

---

## 8. API (`src/api/`)

Fastify와 `api/http/*` 헬퍼(아티팩트, 워크스페이스, 오피스 미리보기, native-open, SSE)는 유지한다.

| 그룹 | 엔드포인트 | 설명 |
| --- | --- | --- |
| 연결 | `GET/POST /connections`, `DELETE /connections/:id`, `POST /connections/:id/test` | API 키·호환 서버 연결 |
| | `POST /connections/chatgpt/login` → `{ authUrl }`, `GET /connections/chatgpt/login/:attemptId` | 구독 OAuth |
| | `GET /connections/discover` | 로컬 서버 탐지 |
| 모델 | `GET /models` | 연결된 모든 모델 카탈로그 |
| 로키 | `GET /rocky/briefing` | 대기 결정 수, 진행 중 작업, 다음 한 걸음 제안 |
| 세션 | `GET/POST /agents/:id/sessions`, `GET /sessions/:id`, `POST /sessions/:id/messages` → `{ runId }` | 로키 포함 모든 에이전트 공통 |
| 런 | `GET /runs/:id/events` (SSE), `POST /runs/:id/abort`, `POST /runs/:id/steer` | |
| 에이전트 | `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`, `GET /agents/:id/versions`, `POST /agents/:id/revert` | |
| 결정 | `GET /decisions?status=pending`, `POST /decisions/:id/resolve` | |
| 업무 | `GET/POST /duties`, `PATCH /duties/:id`, `POST /duties/:id/run` | |
| 지식 | `GET /knowledge`, `GET/PUT /knowledge/*path` | |
| 유지 | `/agents/:id/workspace*`, `/runs/:id/artifacts*`, `/rocky/app-update*`, `/settings/hardware` | 기존 그대로 |

---

## 9. 삭제 / 유지 계획

| 디렉터리 | LOC | 처리 | 메모 |
| --- | --- | --- | --- |
| `connectors/` | 10,100 | 삭제 | Instagram, Threads, Facebook, Tistory, OAuth 브로커 |
| `integrations/` | 2,748 | 삭제 | ECOUNT |
| `skills/` | 1,712 | 삭제 | 스킬 템플릿, 외부 스킬 |
| `messenger/` | 1,143 | 삭제 | Telegram |
| `favorites/` | 188 | 삭제 | |
| `account/` | 4,161 | 삭제 | CLI 로그인·텔레메트리. 제목 요약·에이전트 추천 헬퍼 2개는 새 LLM 클라이언트로 재구현 |
| `auth/` | 366 | 삭제 | CODEX_HOME 프로필 |
| `runtime/` | 4,978 | 대부분 삭제 | `async-event-queue`, `windows-command-spawn`, `runtime-artifact-metadata`, 워크스페이스 스냅샷-비교만 `harness/`·`tools/`로 이동 |
| `sessions/` | 3,460 | 재작성 | 레코드/파일 저장/복구 아이디어 유지. 셸 우회 휴리스틱 ~900줄, 프롬프트 XML 래핑 삭제 |
| `rocky-chat/` | 9,366 | 재작성 → `rocky/` | 스킬 라우팅, 템플릿 인터뷰, Instagram/Tistory/ECOUNT 경로 삭제 |
| `agents/` | 2,315 | 재작성 | 폴더 레이아웃·매니저 골격 유지. 로컬 스킬 서비스, 스킬 브리지, Windows ACL 정리 삭제 |
| `tasks/` | 1,101 | 흡수 | 업무 트리거 실행기로 |
| `api/` | 6,401 | 재작성 | 헬퍼·SSE·워크스페이스·아티팩트·앱 업데이트 라우트 유지 |
| `installer/`, `release/`, `system/`, `cli/` | 2,551 | 유지 | `cli/`의 session/run 명령만 새 API에 맞춤 |
| `electron/` | 826 | 유지 | preload에 자격증명 IPC 추가 |

삭제 전에 끊어야 할 의존: `agents/agent-local-skill-service → connectors`, `api/agent-engine-server·api-types → messenger/connectors/favorites/skills/integrations`, `rocky-chat → skills/integrations/connectors`, `tasks → messenger-types`, `runtime/codex-runtime-environment·sessions/session-service → agents/agent-workspace(스킬 브리지)`.

함께 정리: `playwright` 의존성(커넥터·ECOUNT 전용), `scripts/runtime-capability-probe.sh`, `scripts/oauth-callback-broker.mjs`, ECOUNT 스크립트, `.agents/skills/ecount-oapi`, `rocky-runtime-probe`, 기존 `CONTEXT.md`와 `docs/adr/0001~0003`(v1 커넥터 도메인 → 보관 처리).

웹(`web/src`, 54.3k LOC)은 `codex`, `connector`, `skill`, `template`, `messenger`, `favorite` 도메인을 지우고 `rocky` 도메인을 새 IA로 재작성한다. `shared/ui`, `agent-avatar`, 첨부, 아티팩트 미리보기, 마크다운/엑셀 미리보기, i18n, 데스크톱 크롬은 재사용한다.

---

## 10. 단계별 진행

각 단계는 그 자체로 실행·검증 가능한 상태로 끝낸다.

| 단계 | 내용 | 끝났다는 기준 |
| --- | --- | --- |
| M0 정리 | `feature/v2` 브랜치에서 §9 삭제, 빌드가 깨지지 않게 남은 진입점 정리 | `npm run typecheck`, 남은 테스트 통과 |
| M1 엔진 코어 | `llm/`(OpenAI API + Anthropic API + OpenAI 호환), `harness/`, 기본 도구, 세션 JSONL, `rocky chat` CLI | 가짜 공급자(스크립트 응답)로 루프·도구·중단·컴팩션 단위 테스트, 실제 키로 수동 스모크 |
| M2 API + 새 셸 | 세션/런/SSE 라우트, 새 홈(로키 대화), 연결 화면(API 키 + 로컬 탐지) | 앱에서 로키와 도구 쓰는 대화가 된다 |
| M3 구독 | ChatGPT 구독 OAuth, 한도 표시 | 구독만 연결한 상태로 M2 흐름이 된다 |
| M4 에이전트 + 위임 | 에이전트 CRUD·버전, `delegate`(동기/백그라운드), 위임 카드 UI | 로키가 에이전트 둘에 병렬 위임하고 결과를 정리한다 |
| M5 결정 | 결정함, 권한 게이트, 에스컬레이션, 대기 중 재시작 | 셸 명령 승인 대기 중 앱을 재시작해도 이어진다 |
| M6 업무 + 지식 | 인수인계 인터뷰, 업무 카드, 위임 단계, 일정 실행, 지식 파일 | 업무 하나를 0단계에서 2단계까지 올리는 시나리오 |
| M7 특화 | `로키와 함께`/`직접` 방식, 개선안 diff 승인, 되돌리기, 모델 추천 | 수정 이력 기반 개선안이 결정으로 올라오고 적용·되돌리기 된다 |

테스트는 지금처럼 `node:test` + 컴파일된 `dist/`로 돌린다. 하네스 테스트의 기본은 **가짜 공급자**(미리 정한 이벤트 시퀀스를 내보내는 `LlmClient`)다. 실제 공급자 호출은 수동 스모크로만 한다.

---

## 11. 열린 결정 (사용자 확인 필요)

1. **Claude 구독**: v2 첫 출시는 API 키(+ Max/Team API 크레딧 안내)만 지원하는 것을 권장. "내 컴퓨터의 Claude Code에 맡기기"를 나중에라도 넣을지.
2. **라이선스**: Sign in with ChatGPT 자격을 분명히 하려면 저장소에 MIT 또는 Apache-2.0을 추가할지. 추가하지 않으면 OpenAI 신청서(대기열) 경로.
3. **기존 데이터**: v1 에이전트의 이름·지침·색상만 가져오는 것으로 충분한지, 완전 초기화할지.
4. **웹 앱 재작성 위치**: 기존 `web/` 안에서 도메인을 교체할지(빌드·Electron 연결 유지), 새 디렉터리에서 시작해 교체할지. 권장은 전자.
5. **스킬의 재도입 시점**: 이번에는 전부 지우되, 나중에 "에이전트별 절차서(Markdown)"로 다시 들일지. 지금 설계는 도구 + 지침 + 업무 카드만으로 시작한다.
