# rocky-project

`rocky-project`는 Rocky 운영 콘솔과 agent-engine 백엔드를 함께 담은 저장소입니다. Codex 기반 에이전트 실행, 세션/런 관리, 상태 저장, 그리고 웹 UI 개발 흐름을 한곳에서 다룹니다.

## Requirements

- Node.js 22 이상
- npm
- Codex CLI 사용 시 로컬 인증 완료

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
npm run test:e2e
npm run smoke -- --prompt "Reply with exactly OK"
npm run smoke -- --pptx-smoke
npm run runtime:probe -- --provider codex --write
npm run release:macos
```

## Repository Layout

- `src/`: backend CLI, runtime, API, session, task implementation
- `web/`: Rocky 웹 UI
- `scripts/`: local automation, service helper scripts, and release packaging scripts
- `test/`: backend and integration tests
- `.agents/skills/`: local Codex workflow skills
- `.runtime/`: local runtime state and smoke artifacts

## Installer/update notes

- Windows manual installer/update guidance: `docs/windows-install.md`
- macOS manual update-safe helper guidance: `docs/macos-install.md`
- v0.1.1 installer updates are payload replacements that must preserve existing Rocky state roots, sessions/tasks, runtime homes, and local environment files.

## Notes

- 기본 상태 루트는 `.runtime/agent-engine`입니다.
- 이 저장소는 문서 폴더 대신 루트 `README.md`, 소스 코드, 테스트, 그리고 `.agents/skills/`를 기준으로 운영합니다.
- macOS v0.1.1 배포 산출물은 `npm run release:macos`로 만들며, 설치/제한사항은 `docs/macos-install.md`를 확인합니다.
- 공개 브랜치로 정리할 때는 불필요한 로컬 산출물(`dist/`, `node_modules/`, `.runtime/`, `.env`)을 포함하지 않도록 확인해야 합니다.
