import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";

import { AgentCreatePanel, type AgentCreateFormValues } from "../components/agent-create-panel";
import { AgentGridView, AgentViewModeToggle, type ViewMode } from "../components/agent-grid-view";
import {
  useAgentsQuery,
  useCreateAgentMutation,
} from "../hooks";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";

export function AgentsPage() {
  const navigate = useNavigate();
  const agentsQuery = useAgentsQuery();
  const createAgentMutation = useCreateAgentMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("card");

  async function handleCreateAgent(values: AgentCreateFormValues) {
    const created = await createAgentMutation.mutateAsync({
      name: values.name.trim(),
      description: values.description?.trim() || null,
    });

    setCreateOpen(false);
    navigate(`/agents/${created.id}`);
  }

  const createDialog = (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="mb-6">
          <DialogTitle>새 에이전트 만들기</DialogTitle>
          <DialogDescription>
            기본 정보를 입력하면 바로 작업을 맡길 새 에이전트를 만들 수 있어요
          </DialogDescription>
        </DialogHeader>
        <AgentCreatePanel
          onSubmit={(values) => {
            void handleCreateAgent(values);
          }}
          busy={createAgentMutation.isPending}
          error={
            createAgentMutation.isError
              ? createAgentMutation.error instanceof Error
                ? createAgentMutation.error.message
                : "에이전트 생성 요청에 실패했습니다."
              : null
          }
        />
      </DialogContent>
    </Dialog>
  );

  if (agentsQuery.isLoading) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 bg-muted/80 px-8 py-10 text-center">
        <h3 className="font-heading text-headline-lg font-semibold text-foreground">
          에이전트 가져오는 중
        </h3>
      </Card>
    );
  }

  if (agentsQuery.isError) {
    return (
      <Card className="flex min-h-80 items-center justify-center gap-0 ring-destructive/30 bg-destructive/10 px-8 py-10 text-center">
        <div>
          <h3 className="font-heading text-headline-lg font-semibold text-destructive">
            에이전트를 불러올 수 없습니다
          </h3>
          <p className="mt-4 text-body-lg leading-7 text-destructive">
            {agentsQuery.error instanceof Error
              ? agentsQuery.error.message
              : "에이전트 목록 요청에 실패했습니다."}
          </p>
        </div>
      </Card>
    );
  }

  const agents = filterUserManagedAgents(agentsQuery.data ?? []);
  if (agents.length === 0) {
    return (
      <section className="space-y-6">
        <Card className="gap-0 bg-foreground p-8 text-primary-foreground shadow-lg">
          <h3 className="font-heading text-display-sm font-semibold">
            첫 번째 에이전트를 만들어 보세요
          </h3>
          <p className="mt-4 max-w-2xl text-body-lg leading-8 text-primary-foreground/80">
            에이전트를 만들면 누가 어떤 일을 맡고 있는지 한눈에 보고 바로 작업을 요청할 수 있습니다.
          </p>
          <div className="mt-6">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={16} />
              새 에이전트 만들기
            </Button>
          </div>
        </Card>
        {createDialog}
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/70 pb-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-heading text-headline-lg font-semibold">내 에이전트</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {agents.length}개의 에이전트 중 누구에게 일을 맡길지 선택하세요
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => setCreateOpen(true)}
            disabled={createAgentMutation.isPending}
          >
            <Plus size={16} />
            새 에이전트
          </Button>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Separator className="flex-1" />
          <AgentViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
      </div>

      <div className="min-h-0 flex-1 custom-scrollbar overflow-y-auto py-5 pr-1">
        <AgentGridView agents={agents} viewMode={viewMode} />
      </div>
      {createDialog}
    </section>
  );
}
