import { Bot, Sparkles, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  useAgentsQuery,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from "../hooks";
import { useAgentSessionsQuery } from "@/domains/session/hooks";
import { summarizeTaskRequests } from "@/domains/session/lib/request-status";
import { useAgentEmoji } from "../lib/agent-avatar-store";
import { readAgentSkillIds } from "../lib/agent-skill-store";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import type { AgentRecord } from "../types";
import { AgentAvatar } from "../components/agent-avatar";
import { ArchiveCardActions } from "@/shared/components/archive-card-actions";
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
          description="더 이상 사용하지 않는 에이전트를 모아둡니다. 여기에서만 영구 삭제할 수 있어요."
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
        description="더 이상 사용하지 않는 에이전트를 모아둡니다. 여기에서만 영구 삭제할 수 있어요."
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
              <ArchivedAgentCard agent={agent} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

function ArchivedAgentCard({ agent }: { agent: AgentRecord }) {
  const navigate = useNavigate();
  const updateMutation = useUpdateAgentMutation(agent.id);
  const deleteMutation = useDeleteAgentMutation();
  const sessionsQuery = useAgentSessionsQuery(agent.id, { includeArchived: true });
  const sessions = sessionsQuery.data ?? [];
  const summary = summarizeTaskRequests(sessions);
  const completedCount = summary.counts.completed;
  const equippedSkillCount = readAgentSkillIds(agent.id).length;
  const { emoji } = useAgentEmoji(agent.id);

  function handleRestore() {
    updateMutation.mutate(
      { lifecycle: "active" },
      {
        onSuccess: () => {
          toast.success("에이전트를 복원했습니다.", { description: agent.name });
          navigate(`/agents/${encodeURIComponent(agent.id)}`);
        },
        onError: (error) => {
          toast.error("복원하지 못했습니다.", {
            description: error instanceof Error ? error.message : undefined,
          });
        },
      },
    );
  }

  function handleDelete() {
    const ok = window.confirm(
      `"${agent.name}" 에이전트를 영구 삭제할까요? 되돌릴 수 없어요.`,
    );
    if (!ok) return;
    deleteMutation.mutate(
      { agentId: agent.id, stopRunningSessions: true },
      {
        onSuccess: () => {
          toast.success("에이전트를 삭제했습니다.");
        },
        onError: (error) => {
          toast.error("삭제하지 못했습니다.", {
            description: error instanceof Error ? error.message : undefined,
          });
        },
      },
    );
  }

  const tinted = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 28%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 5%, var(--card))`,
      }
    : undefined;

  return (
    <div
      style={tinted}
      className="flex h-full flex-col rounded-2xl border border-border/70 bg-muted/30 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <AgentAvatar emoji={emoji} color={agent.color} size="lg" className="opacity-80" />
        <div className="flex flex-col items-end gap-1.5">
          <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            보관됨
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Sparkles className="size-3" />
            스킬 {equippedSkillCount}개
          </span>
        </div>
      </div>

      <div className="mt-3 min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{agent.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {agent.description ||
            "장착한 스킬을 발사해 일을 처리하는 내 에이전트입니다."}
        </p>
      </div>

      <dl className="mt-3 grid gap-1.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Zap className="size-3.5 text-muted-foreground" />
          <dt className="text-[10px] uppercase tracking-wide">완료</dt>
          <dd className="ml-auto text-foreground">{completedCount}회</dd>
        </div>
      </dl>

      <div className="mt-4 flex justify-end">
        <ArchiveCardActions
          onDelete={handleDelete}
          onRestore={handleRestore}
          deleting={deleteMutation.isPending}
          restoring={updateMutation.isPending}
        />
      </div>
    </div>
  );
}
