import { Link } from "react-router-dom";
import { Sparkles, Zap } from "lucide-react";

import { useAgentSessionsQuery } from "@/domains/session/hooks";
import { getRunningTaskRequests, summarizeTaskRequests } from "@/domains/session/lib/request-status";
import { useAgentSkillCount } from "../lib/agent-skill-store";
import { useAgentEmoji } from "../lib/agent-avatar-store";
import { AgentAvatar } from "./agent-avatar";
import type { AgentSummary } from "./agent-grid-view";

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const { emoji } = useAgentEmoji(agent.id);
  const sessionsQuery = useAgentSessionsQuery(agent.id, { includeArchived: true });
  const sessions = sessionsQuery.data ?? [];
  const summary = summarizeTaskRequests(sessions);
  const runningCount = getRunningTaskRequests(sessions).length;
  const completedCount = summary.counts.completed;

  const equippedSkillCount = useAgentSkillCount(agent.id);
  const archived = agent.lifecycle === "archived";

  const tinted = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 7%, var(--card))`,
        boxShadow:
          `0 0 0 1px color-mix(in srgb, ${agent.color} 12%, transparent), ` +
          `0 12px 24px color-mix(in srgb, ${agent.color} 10%, transparent)`,
      }
    : undefined;

  const href = archived
    ? `/agents/${encodeURIComponent(agent.id)}?from=archive`
    : `/agents/${encodeURIComponent(agent.id)}`;

  return (
    <Link
      to={href}
      style={tinted}
      className="group flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <AgentAvatar emoji={emoji} color={agent.color} size="lg" />
        <div className="flex flex-col items-end gap-1.5">
          {archived ? (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              보관됨
            </span>
          ) : runningCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {runningCount}건 진행 중
            </span>
          ) : null}
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
    </Link>
  );
}
