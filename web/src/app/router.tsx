import {
  Navigate,
  createBrowserRouter,
  createHashRouter,
} from "react-router-dom";

import { AppShell } from "../shared/components/app-shell";
import { PageState } from "../shared/components/page-state";
import { SettingsPage } from "../domains/settings/pages/settings-page";
import { AgentDetailPage } from "../domains/agent/pages/agent-detail-page";
import { AgentsPage } from "../domains/agent/pages/agents-page";
import { AgentsArchivedPage } from "../domains/agent/pages/agents-archived-page";
import { AgentNewPage } from "../domains/agent/pages/agent-new-page";
import { WorkspaceFilePreviewPage } from "../domains/agent/pages/workspace-file-preview-page";
import { isDesktopRuntime } from "../shared/lib/desktop-api";

const createRouter = isDesktopRuntime(globalThis)
  ? createHashRouter
  : createBrowserRouter;

export const router = createRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <PageState
            eyebrow="Rocky v2"
            title="새 엔진을 준비하고 있어요"
            description="에이전트와 작업 폴더의 파일은 지금도 그대로 쓸 수 있어요."
          />
        ),
      },
      {
        path: "agents",
        element: <AgentsPage />,
      },
      {
        path: "agents/new",
        element: <AgentNewPage />,
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
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "admin",
        element: <Navigate to="/settings" replace />,
      },
      {
        path: "admin/settings",
        element: <Navigate to="/settings" replace />,
      },
      {
        path: "account",
        element: <Navigate to="/settings" replace />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
  {
    path: "/workspace-preview",
    element: <WorkspaceFilePreviewPage />,
  },
]);
