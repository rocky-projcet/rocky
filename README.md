# rocky-project

`rocky-project`는 Rocky 데스크톱 앱(Electron), 웹 UI, Node 백엔드를 함께 담은 저장소입니다.

> **v2 재구축 중.** Codex CLI 기반 엔진과 스킬·커넥터·연동 기능은 M0에서 제거했고, 자체 얇은 에이전트 하네스로 다시 만드는 중입니다. 설계와 단계별 계획은 `docs/v2/engine-design.md`, 화면 시안은 `docs/v2/ux-concept.md`와 `docs/v2/mockups/index.html`, 도메인 용어는 `CONTEXT.md`를 봅니다. 지금은 에이전트 관리와 워크스페이스 파일, 설정(하드웨어), 앱 업데이트만 동작하고 AI 실행은 M1 이후에 돌아옵니다.

## Requirements

- Node.js 22 이상
- npm

## Quick Start

```bash
npm install
npm run build
npm test
```

개발 서버 실행:

```bash
npm run dev
```

백엔드만 실행:

```bash
npm run agent -- serve --host 127.0.0.1 --port 3000
```

웹 UI만 실행:

```bash
npm --prefix web install
npm --prefix web run dev
```

## Common Commands

```bash
npm run typecheck
npm run web:typecheck
npm run web:build
npm run release:macos
```

## Repository Layout

- `src/`: backend CLI, API server, agent registry/workspace, installer/release/system services
- `web/`: Rocky 웹 UI
- `electron/`: 데스크톱 셸
- `scripts/`: local automation, service helper scripts, and release packaging scripts
- `test/`: backend and integration tests
- `docs/v2/`: v2 엔진 설계, UX 컨셉, 디자인 시안
- `docs/archive/v1/`: v1 도메인 용어집과 ADR 보관본
- `.agents/skills/`: local development workflow skills
- `.runtime/`: local runtime state

## Installer/update notes

- Windows manual installer/update guidance: `docs/windows-install.md`
- macOS manual update-safe helper guidance: `docs/macos-install.md`
- v0.1.3 installer updates are payload replacements that must preserve existing Rocky state roots, runtime homes, and local environment files.
- Windows 설치 스크립트는 아직 v1처럼 Codex CLI를 함께 설치합니다. v2 엔진은 Codex CLI를 쓰지 않으며, 설치 단계 정리는 별도로 진행합니다.

## Notes

- 기본 상태 루트는 `.runtime/agent-engine`입니다.
- macOS 배포 산출물은 `npm run release:macos`로 만들며, 설치/제한사항은 `docs/macos-install.md`를 확인합니다.
- 공개 브랜치로 정리할 때는 불필요한 로컬 산출물(`dist/`, `node_modules/`, `.runtime/`, `.env`)을 포함하지 않도록 확인해야 합니다.
