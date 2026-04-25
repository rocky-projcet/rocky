import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, FolderKanban, MessageSquareText } from "lucide-react";

import { useAgentsQuery } from "@/domains/agent/hooks";
import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import { ROCKY_CORE_AGENT_SPEC } from "@/domains/rocky/lib/rocky-agent-catalog";
import { agentEngineClient } from "@/shared/lib/api-client";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RockyAgentPage() {
  const agentsQuery = useAgentsQuery({ includeArchived: true });
  const chatsQuery = useRockyChatsQuery();
  const agents = agentsQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const coreAgent =
    agents.find((agent) => agent.id === ROCKY_CORE_AGENT_SPEC.id) ?? null;
  const sessionsQuery = useQuery({
    queryKey: ["rocky-core-agent-sessions", coreAgent?.id ?? "unknown"],
    queryFn: () =>
      agentEngineClient.listAgentSessions(coreAgent!.id, {
        includeArchived: true,
      }),
    enabled: Boolean(coreAgent?.id),
  });
  const sessions = sessionsQuery.data ?? [];
  const runningSessions = sessions.filter((session) => session.status === "running");
  const latestSession = [...sessions].sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt)
  )[0];
  const latestChat = [...chats].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )[0];

  if (agentsQuery.isLoading || chatsQuery.isLoading) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
        <h3 className="text-lg font-semibold text-foreground">Rocky Core 상태 준비 중</h3>
      </Card>
    );
  }

  if (agentsQuery.isError || chatsQuery.isError || sessionsQuery.isError) {
    const error =
      (agentsQuery.error instanceof Error && agentsQuery.error.message) ||
      (chatsQuery.error instanceof Error && chatsQuery.error.message) ||
      (sessionsQuery.error instanceof Error && sessionsQuery.error.message) ||
      "Rocky Core 상태를 불러오지 못했습니다.";

    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-destructive/10 px-8 py-10 text-center">
        <div>
          <h3 className="text-lg font-semibold text-destructive">
            Rocky Core 상태를 불러올 수 없습니다
          </h3>
          <p className="mt-3 text-sm text-destructive">{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <Card className="shrink-0 gap-0 bg-foreground p-6 text-primary-foreground">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-primary-foreground/65">
              Rocky 전용
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Rocky Core</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-primary-foreground/80">
              홈 화면의 대화와 작업 요청은 하나의 Rocky Core 에이전트와 전용 작업 폴더에서
              처리됩니다. 커스텀 에이전트 관리는 에이전트 화면에서 별도로 유지합니다.
            </p>
          </div>
          <Badge variant="secondary">{coreAgent ? "준비됨" : "대기 중"}</Badge>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">저장된 홈 대화</div>
            <div className="mt-1 text-2xl font-semibold">{chats.length}</div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">진행 중 세션</div>
            <div className="mt-1 text-2xl font-semibold">{runningSessions.length}</div>
          </div>
          <div className="rounded-lg bg-primary-foreground/10 px-4 py-4">
            <div className="text-xs text-primary-foreground/60">최근 홈 대화 업데이트</div>
            <div className="mt-1 text-sm font-medium">
              {formatDateTime(latestChat?.updatedAt)}
            </div>
          </div>
        </div>
      </Card>

      <div className="custom-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
          <section className="rounded-lg border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {ROCKY_CORE_AGENT_SPEC.name}
                  </h3>
                  <Badge variant={coreAgent ? "secondary" : "outline"}>
                    {coreAgent ? "활성" : "첫 대화 후 생성"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {ROCKY_CORE_AGENT_SPEC.role}
                </p>
              </div>
              <Bot className="size-5 text-muted-foreground" />
            </div>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {ROCKY_CORE_AGENT_SPEC.description}
            </p>

            {coreAgent ? (
              <div className="mt-5 grid gap-3">
                <div className="rounded-lg border bg-background px-3 py-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FolderKanban className="size-3.5" />
                    Workspace
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-foreground">
                    {coreAgent.workspaceRoot}
                  </div>
                </div>
                <div className="rounded-lg border bg-background px-3 py-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Activity className="size-3.5" />
                    Runtime Home
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-foreground">
                    {coreAgent.runtimeHome}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-dashed bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                홈에서 첫 Rocky 대화를 시작하면 전용 작업 폴더가 생성됩니다.
              </div>
            )}
          </section>

          <section className="rounded-lg border bg-card p-5">
            <div className="flex items-center gap-2">
              <MessageSquareText className="size-4 text-muted-foreground" />
              <h3 className="text-base font-semibold text-foreground">최근 실행 상태</h3>
            </div>

            <div className="mt-5 grid gap-3">
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">전체 Core 세션</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {coreAgent ? `${sessions.length}개` : "아직 없음"}
                </div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">최근 세션 활동</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {formatDateTime(latestSession?.lastActivityAt)}
                </div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-3">
                <div className="text-xs text-muted-foreground">최근 대화 제목</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {latestChat?.title ?? "아직 없음"}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
