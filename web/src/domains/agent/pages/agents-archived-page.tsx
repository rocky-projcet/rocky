import { Bot } from "lucide-react";

import { AgentCard } from "../components/agent-card";
import { useAgentsQuery } from "../hooks";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { ArchiveEmpty } from "@/shared/components/archive-empty";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Card } from "@/shared/ui/card";

export function AgentsArchivedPage() {
  const agentsQuery = useAgentsQuery({ includeArchived: true });

  if (agentsQuery.isLoading) {
    return (
      <PageContainer>
        <PageHeader
          title="내 에이전트 보관함"
          description="더 이상 사용하지 않는 에이전트를 모아둡니다. 카드를 누르면 상세를 볼 수 있고, 영구 삭제도 여기에서만 가능해요."
        />
        <Card className="flex min-h-60 items-center justify-center bg-muted/40">
          <p className="text-sm text-muted-foreground">보관함을 불러오는 중입니다.</p>
        </Card>
      </PageContainer>
    );
  }

  const agents = filterUserManagedAgents(agentsQuery.data ?? []).filter(
    (agent) => agent.lifecycle === "archived",
  );

  return (
    <PageContainer>
      <PageHeader
        title="내 에이전트 보관함"
        description="더 이상 사용하지 않는 에이전트를 모아둡니다. 카드를 누르면 상세를 볼 수 있고, 영구 삭제도 여기에서만 가능해요."
      />

      {agents.length === 0 ? (
        <ArchiveEmpty
          icon={Bot}
          title="보관된 에이전트가 없습니다."
          description="에이전트 상세에서 보관 버튼을 누르면 여기로 옮겨와요."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id}>
              <AgentCard agent={agent} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
