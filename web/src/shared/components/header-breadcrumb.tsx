import { Link, useLocation, useParams } from "react-router-dom";

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

function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function HeaderBreadcrumb() {
  const location = useLocation();
  const params = useParams<{ agentId?: string; sessionId?: string }>();
  const agentQuery = useAgentQuery(params.agentId);
  const sessionQuery = useSessionQuery(params.sessionId);
  const agentName = agentQuery.data?.name ?? params.agentId ?? "";
  const sessionLabel = sessionQuery.data?.title
    ? truncate(sessionQuery.data.title, 20)
    : params.sessionId ?? "";

  // /agents/:agentId/sessions/:sessionId
  if (params.agentId && params.sessionId) {
    const isArchived = agentQuery.data?.lifecycle === "archived";
    const rootLabel = isArchived ? "보관함" : "에이전트";
    const rootPath = isArchived ? "/agents/archived" : "/agents";

    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to={rootPath} />}>
              {rootLabel}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to={`/agents/${params.agentId}`} />}>
              {agentName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>작업 요청</BreadcrumbPage>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{sessionLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // /agents/:agentId
  if (params.agentId) {
    const isArchived = agentQuery.data?.lifecycle === "archived";
    const rootLabel = isArchived ? "보관함" : "에이전트";
    const rootPath = isArchived ? "/agents/archived" : "/agents";

    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to={rootPath} />}>
              {rootLabel}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{agentName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  // 그 외 페이지도 breadcrumb 스타일로 통일
  const pathname = location.pathname;
  let title = "에이전트 엔진";
  if (pathname === "/agents/archived") title = "보관함";
  else if (pathname.startsWith("/runs/")) title = "대화 상세";
  else if (pathname.startsWith("/settings") || pathname.startsWith("/account")) title = "설정";
  else if (pathname.startsWith("/agents")) title = "에이전트";

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
