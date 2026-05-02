import { Link } from "react-router-dom";
import { ArrowRight, Sparkles, Zap } from "lucide-react";

import { useAgentSessionsQuery } from "@/domains/session/hooks";
import { summarizeTaskRequests } from "@/domains/session/lib/request-status";
import { useAgentSkillCount } from "../lib/agent-skill-store";
import { useAgentEmoji } from "../lib/agent-avatar-store";
import { AgentAvatar } from "./agent-avatar";
import { Badge } from "@/shared/ui/badge";
import type { AgentSummary } from "./agent-grid-view";

export function AgentListItem({ agent }: { agent: AgentSummary }) {
  const { emoji } = useAgentEmoji(agent.id);
  const sessionsQuery = useAgentSessionsQuery(agent.id, {
    includeArchived: true,
  });
  const sessions = sessionsQuery.data ?? [];
  const summary = summarizeTaskRequests(sessions);
  const equippedSkillCount = useAgentSkillCount(agent.id);

  const tinted = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 7%, var(--card))`,
      }
    : undefined;

  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      style={tinted}
      className="group flex items-center gap-4 rounded-2xl border border-border/70 bg-card px-4 py-3 no-underline shadow-sm transition hover:shadow-md"
    >
      <AgentAvatar emoji={emoji} color={agent.color} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-sm font-semibold text-foreground">{agent.name}</h4>
          {agent.lifecycle === "archived" ? (
            <Badge className="rounded-full bg-secondary text-secondary-foreground">
              보관됨
            </Badge>
          ) : null}
        </div>
        {agent.description ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {agent.description}
          </p>
        ) : null}
      </div>
      <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
        <span className="inline-flex items-center gap-1">
          <Sparkles className="size-3.5" />
          스킬 {equippedSkillCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <Zap className="size-3.5" />
          완료 {summary.counts.completed}
        </span>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
