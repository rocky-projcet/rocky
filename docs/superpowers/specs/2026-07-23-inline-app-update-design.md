# Inline Rocky App Update Design

## Goal

Rocky 데스크톱 앱의 상단 크롬에서 Windows와 macOS 업데이트를 확인하고, 릴리스 내용을 읽고, 검증된 설치 파일을 내려받은 뒤 자동으로 플랫폼 설치 흐름을 시작한다.

## Confirmed UI

- 업데이트 진입점은 별도 설정 화면이 아니라 데스크톱 상단 메뉴 오른쪽의 아이콘이다.
- 새 버전이 있으면 아이콘의 상태 점으로 알린다.
- 아이콘을 누르면 현재/최신 버전, 릴리스 내용, 설치 파일 정보, 다운로드 진행률, 오류 복구 동선을 작은 팝오버에 표시한다.
- 사용자가 `업데이트`를 누르면 checksum 검증이 가능한 설치 파일을 다운로드하고, 완료 직후 자동으로 설치 파일을 연다.
- macOS에서는 traffic light 오른쪽에 사이드바 접기 버튼을 온전히 배치하고, 기존 `ArrowLeft`/`ArrowRight` 아이콘과 메뉴를 이어서 표시한다.
- macOS 상단 중앙의 `Rocky` 제목 및 접기/히스토리 사이 구분선은 두지 않는다.
- Windows에서는 업데이트 아이콘을 기본 창 제어 버튼 왼쪽에 둔다.

## Update Service

- 기존 `AppUpdateService`를 Windows 전용 구현에서 `win32`와 `darwin` 공통 서비스로 확장한다.
- Windows asset은 기존 `.exe` 선택 규칙을 유지한다.
- macOS asset은 `.pkg`, `.dmg`, `.app.zip` 순으로 선택한다.
- GitHub asset digest 또는 checksum manifest가 없는 asset은 설치하지 않는다.
- 다운로드 중 수신 바이트, 전체 바이트, 퍼센트를 상태에 기록한다.
- Windows는 검증된 `.exe`를 실행한다.
- macOS는 검증된 asset을 `/usr/bin/open`으로 연다. `.pkg`는 Installer, `.dmg`는 Finder mount, `.app.zip`은 Archive Utility 흐름으로 이어진다.
- 자동 실행이 실패하거나 수동 설치가 필요한 경우 다운로드 위치 열기를 제공한다.
- state root는 애플리케이션 bundle 밖의 `~/Library/Application Support/Rocky/agent-engine`에 유지되며 설치 파일 실행 과정에서 삭제하거나 이동하지 않는다.

## User-facing Limitations

- 서명 또는 공증되지 않은 빌드는 Gatekeeper 경고가 표시될 수 있다.
- 개발용 macOS 빌드는 배포 형태에 따라 Node.js가 필요할 수 있다.
- `.dmg`와 `.app.zip` fallback은 사용자가 Finder에서 설치를 마무리해야 할 수 있다.
- 현재 설치된 앱에 업데이트 API가 없다면 첫 지원 버전은 수동 설치가 필요하다.

## Failure Recovery

- 네트워크/Release 조회 실패: 같은 팝오버에서 다시 확인한다.
- asset 누락/checksum 누락/checksum 불일치: 설치를 차단하고 오류를 표시한다.
- Installer 실행 실패: 오류와 다운로드 폴더 열기 버튼을 표시한다.
- 최신 버전 없음: 최신 상태를 표시하고 다시 확인할 수 있다.

## Verification

- 서비스 테스트로 macOS asset 우선순위, checksum, 진행률, Installer 실행과 실패를 검증한다.
- API 테스트로 check/download/install/reveal 상태 전이를 검증한다.
- web 상태 테스트로 플랫폼별 라벨, 자동 설치 가능 여부, 진행률, 복구 동선을 검증한다.
- TypeScript, 전체 Node 테스트, web build, Electron build를 실행한다.
- 실제 macOS Electron 창에서 traffic light, 접기/뒤로/앞으로, 메뉴, 업데이트 아이콘과 팝오버를 확인한다.
