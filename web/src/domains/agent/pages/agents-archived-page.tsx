import { useState } from "react";

import { useAgentsQuery } from "../hooks";
import { AgentGridView, AgentViewModeToggle, type ViewMode } from "../components/agent-grid-view";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { Card } from "@/shared/ui/card";
import { Separator } from "@/shared/ui/separator";

export function AgentsArchivedPage() {
  const agentsQuery = useAgentsQuery({ includeArchived: true });
  const [viewMode, setViewMode] = useState<ViewMode>("card");

  if (agentsQuery.isLoading) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
        <div>
          <h3 className="font-heading text-headline-lg font-semibold text-foreground">
            보관함 불러오는 중
          </h3>
        </div>
      </Card>
    );
  }

  const allAgents = filterUserManagedAgents(agentsQuery.data ?? []);
  const archived = allAgents.filter((a) => a.lifecycle === "archived");

  return (
    <section className="space-y-5">
      <div>
        <h3 className="font-heading text-headline-lg font-semibold">보관함</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {archived.length === 0
            ? "보관된 에이전트가 없습니다"
            : `보관된 에이전트 ${archived.length}개`}
        </p>
      </div>

      {archived.length > 0 ? (
        <>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <AgentViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>
          <AgentGridView agents={archived} viewMode={viewMode} />
        </>
      ) : null}
    </section>
  );
}
