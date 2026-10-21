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
import { useI18n } from "@/shared/lib/i18n-provider";

interface Crumb {
  label: string;
  to?: string;
}

export function isNestedRoute(pathname: string): boolean {
  if (/^\/agents\/(?!archived(?:\/|$)).+/.test(pathname)) return true;
  return false;
}

export type FromContext = { kind: "archive" } | null;

export function parseFromParam(search: URLSearchParams): FromContext {
  const raw = search.get("from");
  if (raw === "archive") return { kind: "archive" };
  return null;
}

interface RouteParams {
  agentId?: string;
}

export function HeaderBreadcrumb() {
  const { t } = useI18n();
  const location = useLocation();
  const matches = useMatches();
  const [searchParams] = useSearchParams();
  const params: RouteParams = matches.reduce<RouteParams>((acc, match) => {
    return { ...acc, ...(match.params as RouteParams) };
  }, {});

  const fromContext = parseFromParam(searchParams);
  const agentQuery = useAgentQuery(params.agentId);

  const crumbs = resolveCrumbs({
    pathname: location.pathname,
    params,
    fromContext,
    agentName: agentQuery.data?.name,
    agentLifecycle: agentQuery.data?.lifecycle,
    t,
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

function agentRootCrumb(
  archived: boolean,
  t: (key: string) => string,
): Crumb {
  return archived
    ? { label: t("shell.agentsArchive"), to: "/agents/archived" }
    : { label: t("shell.agents"), to: "/agents" };
}

function resolveCrumbs(args: {
  pathname: string;
  params: RouteParams;
  fromContext: FromContext;
  agentName?: string;
  agentLifecycle?: string;
  t: (key: string) => string;
}): Crumb[] | null {
  const { pathname, params, fromContext, t } = args;
  const fromArchive = fromContext?.kind === "archive";
  const archivedContextAgent = args.agentLifecycle === "archived";

  // /agents/new
  if (pathname === "/agents/new") {
    return [
      { label: t("shell.agents"), to: "/agents" },
      { label: t("breadcrumb.newAgent") },
    ];
  }

  // /agents/:agentId
  if (params.agentId) {
    const archived = archivedContextAgent || fromArchive;
    const agentLabel = args.agentName ?? params.agentId;
    return [
      agentRootCrumb(archived, t),
      { label: agentLabel },
    ];
  }

  return null;
}
