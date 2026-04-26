import {
  Navigate,
  createBrowserRouter,
} from "react-router-dom";

import { AppShell } from "../shared/components/app-shell";
import { DebugModeOnly } from "../shared/components/debug-mode-only";
import { PageState } from "../shared/components/page-state";
import { AccountPage } from "../domains/codex/pages/account-page";
import { AgentDetailPage } from "../domains/agent/pages/agent-detail-page";
import { AgentsPage } from "../domains/agent/pages/agents-page";
import { AgentsArchivedPage } from "../domains/agent/pages/agents-archived-page";
import { RockyAgentPage } from "../domains/rocky/pages/rocky-agent-page";
import { HomePage } from "../domains/rocky/pages/home-page";
import {
  TemplateBuilderPage,
  TemplatesPage,
} from "../domains/template/pages/templates-page";
import { RunInspectorPage } from "../domains/run/pages/run-inspector-page";
import { SessionWorkspacePage } from "../domains/session/pages/session-workspace-page";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "agents",
        element: <AgentsPage />,
      },
      {
        path: "templates",
        element: <TemplatesPage />,
      },
      {
        path: "templates/new",
        element: <TemplateBuilderPage />,
      },
      {
        path: "templates/:templateId/edit",
        element: <TemplateBuilderPage />,
      },
      {
        path: "agents/archived",
        element: <AgentsArchivedPage />,
      },
      {
        path: "agents/:agentId",
        element: <AgentDetailPage />,
      },
      {
        path: "agents/:agentId/sessions/:sessionId",
        element: <SessionWorkspacePage />,
      },
      {
        path: "rocky/agent",
        element: (
          <DebugModeOnly
            title="Rocky 관리 화면은 디버그 모드에서만 표시합니다"
            description="일반 모드에서는 Rocky를 홈에서 사용하고, Core 상태 관리는 전용 화면에서 분리해 확인합니다."
          >
            <RockyAgentPage />
          </DebugModeOnly>
        ),
      },
      {
        path: "runs",
        element: (
          <PageState
            eyebrow="라우트 전용"
            title="실행 기록 열기"
            description="세션 트랜스크립트 항목, 실시간 상태 카드, 또는 /runs/:runId 직접 링크를 사용하세요. MVP 셸은 전체 실행 목록을 제공하지 않습니다."
          />
        ),
      },
      {
        path: "runs/:runId",
        element: <RunInspectorPage />,
      },
      {
        path: "settings",
        element: <AccountPage />,
      },
      {
        path: "account",
        element: <Navigate to="/settings" replace />,
      }
    ],
  },
]);
