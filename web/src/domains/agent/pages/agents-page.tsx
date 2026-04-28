import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

import { AgentCard } from "../components/agent-card";
import { useAgentsQuery } from "../hooks";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";

export function AgentsPage() {
  const agentsQuery = useAgentsQuery();

  if (agentsQuery.isLoading) {
    return (
      <PageContainer>
        <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
          <h3 className="text-2xl font-semibold tracking-normal text-foreground">
            에이전트 가져오는 중
          </h3>
        </Card>
      </PageContainer>
    );
  }

  if (agentsQuery.isError) {
    return (
      <PageContainer>
        <Card className="flex min-h-80 items-center justify-center gap-0 ring-destructive/30 bg-destructive/10 px-8 py-10 text-center">
          <div>
            <h3 className="text-2xl font-semibold tracking-normal text-destructive">
              에이전트를 불러올 수 없습니다
            </h3>
            <p className="mt-4 text-sm leading-7 text-destructive">
              {agentsQuery.error instanceof Error
                ? agentsQuery.error.message
                : "에이전트 목록 요청에 실패했습니다."}
            </p>
          </div>
        </Card>
      </PageContainer>
    );
  }

  const agents = filterUserManagedAgents(agentsQuery.data ?? []).filter(
    (agent) => agent.lifecycle === "active",
  );

  if (agents.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="첫 번째 에이전트를 만들어 보세요"
          description="에이전트를 만들면 누가 어떤 일을 맡고 있는지 한눈에 보고 바로 작업을 요청할 수 있어요."
          actions={
            <Button render={<Link to="/agents/new" />}>
              <Plus size={16} />
              새 에이전트 만들기
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="내 에이전트"
        description={`${agents.length}명의 에이전트 중 누구에게 일을 맡길지 골라주세요.`}
        actions={
          <Button render={<Link to="/agents/new" />}>
            <Plus size={16} />
            새 에이전트
          </Button>
        }
      />

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <li key={agent.id}>
            <AgentCard agent={agent} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
