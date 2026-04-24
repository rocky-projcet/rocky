import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, ExternalLink, FolderKanban, MessageSquareText } from "lucide-react";

import { useAgentsQuery } from "@/domains/agent/hooks";
import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import {
  ROCKY_INTERNAL_AGENT_SPECS,
  type RockyInternalAgentSpec,
} from "@/domains/rocky/lib/rocky-agent-catalog";
import { agentEngineClient } from "@/shared/lib/api-client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

import type { AgentRecord } from "@/domains/agent/types";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function RockyAgentCard(props: {
  spec: RockyInternalAgentSpec;
  agent: AgentRecord | null;
}) {
  const sessionsQuery = useQuery({
    queryKey: ["rocky-agent-sessions", props.agent?.id ?? "unknown"],
    queryFn: () =>
      agentEngineClient.listAgentSessions(props.agent!.id, {
        includeArchived: true,
      }),
    enabled: Boolean(props.agent?.id),
  });
  const sessions = sessionsQuery.data ?? [];
  const runningSessions = sessions.filter((session) => session.status === "running");
  const latestSession = [...sessions].sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt)
  )[0];

  return (
    <Card className="gap-0 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{props.spec.name}</h3>
            <Badge variant={props.agent ? "secondary" : "outline"}>
              {props.agent ? "준비됨" : "대기 중"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{props.spec.role}</p>
        </div>
        <Bot className="size-5 text-muted-foreground" />
      </div>

      <p className="mt-4 text-sm leading-6 text-muted-foreground">{props.spec.description}</p>

      {props.agent ? (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border bg-muted/40 px-3 py-3">
              <div className="text-xs text-muted-foreground">에이전트 ID</div>
              <div className="mt-1 break-all text-sm font-medium">{props.agent.id}</div>
            </div>
            <div className="rounded-lg border bg-muted/40 px-3 py-3">
              <div className="text-xs text-muted-foreground">진행 중 요청</div>
              <div className="mt-1 text-sm font-medium">{runningSessions.length}개</div>
            </div>
            <div className="rounded-lg border bg-muted/40 px-3 py-3">
              <div className="text-xs text-muted-foreground">마지막 활동</div>
              <div className="mt-1 text-sm font-medium">
                {formatDateTime(latestSession?.lastActivityAt)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="rounded-lg border bg-background px-3 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FolderKanban className="size-3.5" />
                Workspace
              </div>
              <div className="mt-1 break-all font-mono text-xs text-foreground">
                {props.agent.workspaceRoot}
              </div>
            </div>
            <div className="rounded-lg border bg-background px-3 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="size-3.5" />
                Runtime Home
              </div>
              <div className="mt-1 break-all font-mono text-xs text-foreground">
                {props.agent.runtimeHome}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to={`/agents/${props.agent.id}`} />}
            >
              상세 보기
              <ExternalLink className="size-4" />
            </Button>
            {latestSession ? (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link to={`/agents/${props.agent.id}/sessions/${latestSession.id}`} />}
              >
                최근 세션
                <MessageSquareText className="size-4" />
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
          아직 생성되지 않았습니다. Rocky가 이 역할을 처음 사용하면 내부 에이전트가 준비됩니다.
        </div>
      )}
    </Card>
  );
}

export function RockyAgentPage() {
  const agentsQuery = useAgentsQuery({ includeArchived: true });
  const chatsQuery = useRockyChatsQuery();

  if (agentsQuery.isLoading || chatsQuery.isLoading) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
        <h3 className="text-lg font-semibold text-foreground">Rocky 관리 화면 준비 중</h3>
      </Card>
    );
  }

  if (agentsQuery.isError || chatsQuery.isError) {
    const error =
      (agentsQuery.error instanceof Error && agentsQuery.error.message) ||
      (chatsQuery.error instanceof Error && chatsQuery.error.message) ||
      "Rocky 상태를 불러오지 못했습니다.";

    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-destructive/10 px-8 py-10 text-center">
        <div>
          <h3 className="text-lg font-semibold text-destructive">Rocky 상태를 불러올 수 없습니다</h3>
          <p className="mt-3 text-sm text-destructive">{error}</p>
        </div>
      </Card>
    );
  }

  const agents = agentsQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const agentsById = new Map(agents.map((agent) => [agent.id, agent] as const));
  const latestChat = [...chats].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )[0];
  const createdCount = ROCKY_INTERNAL_AGENT_SPECS.filter((spec) => agentsById.has(spec.id)).length;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <Card className="shrink-0 gap-0 bg-foreground p-6 text-primary-foreground">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-primary-foreground/65">디버그 전용</p>
            <h2 className="mt-2 text-2xl font-semibold">Rocky 관리</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-foreground/80">
              홈 화면 뒤에서 동작하는 Rocky 내부 에이전트, 최근 대화 저장 상태, 위임 흐름을 한곳에서
              확인합니다.
            </p>
          </div>
          <Badge variant="secondary">내부 에이전트 {createdCount}/{ROCKY_INTERNAL_AGENT_SPECS.length}</Badge>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">저장된 홈 대화</div>
            <div className="mt-1 text-2xl font-semibold">{chats.length}</div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">최근 홈 대화 업데이트</div>
            <div className="mt-1 text-sm font-medium">
              {formatDateTime(latestChat?.updatedAt)}
            </div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">최근 대화 제목</div>
            <div className="mt-1 text-sm font-medium">
              {latestChat?.title ?? "아직 없음"}
            </div>
          </div>
        </div>
      </Card>

      <div className="custom-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4 xl:grid-cols-2">
          {ROCKY_INTERNAL_AGENT_SPECS.map((spec) => (
            <RockyAgentCard
              key={spec.id}
              spec={spec}
              agent={agentsById.get(spec.id) ?? null}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
