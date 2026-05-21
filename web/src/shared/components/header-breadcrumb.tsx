import { Fragment } from "react";
import { Link, useLocation, useMatches, useSearchParams } from "react-router-dom";

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

export type FromContext =
  | { kind: "agent"; agentId: string }
  | { kind: "archive" }
  | null;

export function parseFromParam(search: URLSearchParams): FromContext {
  const raw = search.get("from");
  if (!raw) return null;
  if (raw === "archive") return { kind: "archive" };
  if (raw.startsWith("agent:")) {
    const agentId = raw.slice("agent:".length);
    if (agentId) return { kind: "agent", agentId };
  }
  return null;
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
  const [searchParams] = useSearchParams();
  const params: RouteParams = matches.reduce<RouteParams>((acc, match) => {
    return { ...acc, ...(match.params as RouteParams) };
  }, {});

  const fromContext = parseFromParam(searchParams);
  const fromAgentId =
    fromContext?.kind === "agent" ? fromContext.agentId : undefined;
  const contextAgentId = params.agentId ?? fromAgentId;

  const agentQuery = useAgentQuery(contextAgentId);
  const sessionQuery = useSessionQuery(params.sessionId);
  const taskQuery = useRockyChatQuery(params.taskId ?? null);
  const { allTemplates } = useMdTemplates();

  const crumbs = resolveCrumbs({
    pathname: location.pathname,
    params,
    fromContext,
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

function agentRootCrumb(archived: boolean): Crumb {
  return archived
    ? { label: "내 에이전트 보관함", to: "/agents/archived" }
    : { label: "내 에이전트", to: "/agents" };
}

function agentDetailHref(agentId: string, archived: boolean): string {
  return archived
    ? `/agents/${agentId}?from=archive`
    : `/agents/${agentId}`;
}

function resolveCrumbs(args: {
  pathname: string;
  params: RouteParams;
  fromContext: FromContext;
  agentName?: string;
  agentLifecycle?: string;
  sessionTitle?: string;
  taskTitle?: string;
  skillTitle?: string;
}): Crumb[] | null {
  const { pathname, params, fromContext } = args;
  const fromArchive = fromContext?.kind === "archive";
  const fromAgent = fromContext?.kind === "agent" ? fromContext : null;
  const archivedContextAgent = args.agentLifecycle === "archived";

  // /agents/:agentId/sessions/:sessionId
  if (params.agentId && params.sessionId) {
    const archived = archivedContextAgent || fromArchive;
    const agentLabel = args.agentName ?? params.agentId;
    const sessionLabel = args.sessionTitle
      ? truncate(args.sessionTitle, 20)
      : params.sessionId;
    return [
      agentRootCrumb(archived),
      { label: agentLabel, to: agentDetailHref(params.agentId, archived) },
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
    const archived = archivedContextAgent || fromArchive;
    const agentLabel = args.agentName ?? params.agentId;
    return [
      agentRootCrumb(archived),
      { label: agentLabel },
    ];
  }

  // /skills/new
  if (pathname === "/skills/new") {
    return [
      { label: "공용 스킬", to: "/skills" },
      { label: "새 스킬" },
    ];
  }

  // /skills/external
  if (pathname === "/skills/external") {
    return [
      { label: "공용 스킬", to: "/skills" },
      { label: "외부 스킬 추가" },
    ];
  }

  // /skills/:skillId
  if (params.skillId) {
    const skillLabel = args.skillTitle
      ? truncate(args.skillTitle, 30)
      : params.skillId;
    if (fromAgent && args.agentName) {
      return [
        agentRootCrumb(archivedContextAgent),
        {
          label: args.agentName,
          to: agentDetailHref(fromAgent.agentId, archivedContextAgent),
        },
        { label: skillLabel },
      ];
    }
    return [
      { label: "공용 스킬", to: "/skills" },
      { label: skillLabel },
    ];
  }

  // /tasks/:taskId
  if (params.taskId) {
    const taskLabel = args.taskTitle
      ? truncate(args.taskTitle, 30)
      : params.taskId;
    if (fromAgent && args.agentName) {
      return [
        agentRootCrumb(archivedContextAgent),
        {
          label: args.agentName,
          to: agentDetailHref(fromAgent.agentId, archivedContextAgent),
        },
        { label: taskLabel },
      ];
    }
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
