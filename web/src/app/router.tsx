import {
  Navigate,
  createBrowserRouter,
  useParams,
} from "react-router-dom";

function RedirectTemplateEditToSkill() {
  const { templateId } = useParams<{ templateId: string }>();
  return <Navigate to={`/skills/${encodeURIComponent(templateId ?? "")}/edit`} replace />;
}

import { AppShell } from "../shared/components/app-shell";
import { PageState } from "../shared/components/page-state";
import { AccountPage } from "../domains/codex/pages/account-page";
import { AgentDetailPage } from "../domains/agent/pages/agent-detail-page";
import { AgentsPage } from "../domains/agent/pages/agents-page";
import { AgentsArchivedPage } from "../domains/agent/pages/agents-archived-page";
import { AgentNewPage } from "../domains/agent/pages/agent-new-page";
import { WorkspaceFilePreviewPage } from "../domains/agent/pages/workspace-file-preview-page";
import { RockyAgentPage } from "../domains/rocky/pages/rocky-agent-page";
import { HomePage, RockyTaskDetailPage } from "../domains/rocky/pages/home-page";
import { SearchPage } from "../domains/rocky/pages/search-page";
import { FavoritesPage } from "../domains/favorite/favorites-page";
import { IntegrationsPage } from "../domains/connector/pages/integrations-page";
import { TasksPage } from "../domains/rocky/pages/tasks-page";
import {
  TemplateBuilderPage,
  TemplatesPage,
} from "../domains/template/pages/templates-page";
import { SkillsPage } from "../domains/skill/pages/skills-page";
import { SkillsArchivedPage } from "../domains/skill/pages/skills-archived-page";
import { SkillNewPage } from "../domains/skill/pages/skill-new-page";
import { SkillDetailPage } from "../domains/skill/pages/skill-detail-page";
import { SkillTemplateDetailPage } from "../domains/skill/pages/skill-template-detail-page";
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
        path: "search",
        element: <SearchPage />,
      },
      {
        path: "favorites",
        element: <FavoritesPage />,
      },
      {
        path: "integrations",
        element: <IntegrationsPage />,
      },
      {
        path: "tasks",
        element: <TasksPage />,
      },
      {
        path: "tasks/:taskId",
        element: <RockyTaskDetailPage />,
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
        path: "templates",
        element: <TemplatesPage />,
      },
      {
        path: "templates/new",
        element: <TemplateBuilderPage />,
      },
      {
        path: "templates/:templateId/edit",
        element: <RedirectTemplateEditToSkill />,
      },
      {
        path: "templates/archived",
        element: <Navigate to="/templates" replace />,
      },
      {
        path: "templates/:kind",
        element: <SkillTemplateDetailPage />,
      },
      {
        path: "skills",
        element: <SkillsPage />,
      },
      {
        path: "skills/new",
        element: <SkillNewPage />,
      },
      {
        path: "skills/archived",
        element: <SkillsArchivedPage />,
      },
      {
        path: "skills/:skillId/edit",
        element: <SkillNewPage />,
      },
      {
        path: "skills/:skillId",
        element: <SkillDetailPage />,
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
        path: "admin",
        element: <Navigate to="/admin/rocky" replace />,
      },
      {
        path: "admin/rocky",
        element: <RockyAgentPage />,
      },
      {
        path: "admin/settings",
        element: <AccountPage />,
      },
      {
        path: "rocky/agent",
        element: <Navigate to="/admin/rocky" replace />,
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
        element: <Navigate to="/admin/settings" replace />,
      },
      {
        path: "account",
        element: <Navigate to="/admin/settings" replace />,
      }
    ],
  },
  {
    path: "/workspace-preview",
    element: <WorkspaceFilePreviewPage />,
  },
]);
