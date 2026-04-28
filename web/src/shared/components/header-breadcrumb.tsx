import { Fragment } from "react";
import { Link, useLocation, useMatches } from "react-router-dom";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import { useAgentQuery } from "@/domains/agent/hooks";
import { useSessionQuery } from "@/domains/session/hooks";
import { useRockyChatQuery } from "@/domains/rocky/hooks";
import { useMdTemplates } from "@/domains/template/hooks";
import {
  SKILL_TEMPLATES,
  type SkillKind,
} from "@/domains/skill/lib/skill-template-catalog";

const SKILL_KINDS: SkillKind[] = [
  "document",
  "content",
  "data",
  "translation",
  "research",
  "summary",
  "message",
];

function isSkillKind(value: string): value is SkillKind {
  return (SKILL_KINDS as string[]).includes(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

interface Crumb {
  label: string;
  to?: string;
}

export function isNestedRoute(pathname: string): boolean {
  if (/^\/skills\/(?!archived(?:\/|$)).+/.test(pathname)) return true;
  if (/^\/agents\/(?!archived(?:\/|$)).+/.test(pathname)) return true;
  if (/^\/tasks\/.+/.test(pathname)) return true;
  if (/^\/templates\/(?!archived(?:\/|$)).+/.test(pathname)) return true;
  if (/^\/runs\/.+/.test(pathname)) return true;
  return false;
}

interface RouteParams {
  agentId?: string;
  sessionId?: string;
  skillId?: string;
  taskId?: string;
  kind?: string;
  runId?: string;
}

export function HeaderBreadcrumb() {
  const location = useLocation();
  const matches = useMatches();
  const params: RouteParams = matches.reduce<RouteParams>((acc, match) => {
    return { ...acc, ...(match.params as RouteParams) };
  }, {});

  const agentQuery = useAgentQuery(params.agentId);
  const sessionQuery = useSessionQuery(params.sessionId);
  const taskQuery = useRockyChatQuery(params.taskId ?? null);
  const { allTemplates } = useMdTemplates();

  const crumbs = resolveCrumbs({
    pathname: location.pathname,
    params,
    agentName: agentQuery.data?.name,
    agentLifecycle: agentQuery.data?.lifecycle,
    sessionTitle: sessionQuery.data?.title ?? undefined,
    taskTitle: taskQuery.data?.title,
    skillTitle: params.skillId
      ? allTemplates.find((entry) => entry.id === params.skillId)?.title
      : undefined,
  });

  if (!crumbs || crumbs.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={`${index}-${crumb.label}`}>
              <BreadcrumbItem>
                {!isLast && crumb.to ? (
                  <BreadcrumbLink render={<Link to={crumb.to} />}>
                    {crumb.label}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast ? <BreadcrumbSeparator /> : null}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function resolveCrumbs(args: {
  pathname: string;
  params: RouteParams;
  agentName?: string;
  agentLifecycle?: string;
  sessionTitle?: string;
  taskTitle?: string;
  skillTitle?: string;
}): Crumb[] | null {
  const { pathname, params } = args;

  // /agents/:agentId/sessions/:sessionId
  if (params.agentId && params.sessionId) {
    const archived = args.agentLifecycle === "archived";
    const rootLabel = archived ? "보관함" : "내 에이전트";
    const rootPath = archived ? "/agents/archived" : "/agents";
    const agentLabel = args.agentName ?? params.agentId;
    const sessionLabel = args.sessionTitle
      ? truncate(args.sessionTitle, 20)
      : params.sessionId;
    return [
      { label: rootLabel, to: rootPath },
      { label: agentLabel, to: `/agents/${params.agentId}` },
      { label: "작업 요청" },
      { label: sessionLabel },
    ];
  }

  // /agents/new
  if (pathname === "/agents/new") {
    return [
      { label: "내 에이전트", to: "/agents" },
      { label: "새 에이전트" },
    ];
  }

  // /agents/:agentId
  if (params.agentId) {
    const archived = args.agentLifecycle === "archived";
    const rootLabel = archived ? "보관함" : "내 에이전트";
    const rootPath = archived ? "/agents/archived" : "/agents";
    const agentLabel = args.agentName ?? params.agentId;
    return [
      { label: rootLabel, to: rootPath },
      { label: agentLabel },
    ];
  }

  // /skills/new
  if (pathname === "/skills/new") {
    return [
      { label: "스킬", to: "/skills" },
      { label: "새 스킬" },
    ];
  }

  // /skills/:skillId
  if (params.skillId) {
    const skillLabel = args.skillTitle
      ? truncate(args.skillTitle, 30)
      : params.skillId;
    return [
      { label: "스킬", to: "/skills" },
      { label: skillLabel },
    ];
  }

  // /tasks/:taskId
  if (params.taskId) {
    const taskLabel = args.taskTitle
      ? truncate(args.taskTitle, 30)
      : params.taskId;
    return [
      { label: "작업", to: "/tasks" },
      { label: taskLabel },
    ];
  }

  // /templates/new
  if (pathname === "/templates/new") {
    return [
      { label: "스킬 템플릿", to: "/templates" },
      { label: "새 템플릿" },
    ];
  }

  // /templates/:kind
  if (params.kind) {
    const kindLabel =
      isSkillKind(params.kind) ? SKILL_TEMPLATES[params.kind].label : params.kind;
    return [
      { label: "스킬 템플릿", to: "/templates" },
      { label: kindLabel },
    ];
  }

  // /runs/:runId
  if (params.runId) {
    return [
      { label: "실행 기록" },
      { label: truncate(params.runId, 20) },
    ];
  }

  return null;
}
