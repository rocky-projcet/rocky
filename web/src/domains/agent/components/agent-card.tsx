import { Link } from "react-router-dom";

import { useAgentEmoji } from "../lib/agent-avatar-store";
import { AgentAvatar } from "./agent-avatar";
import type { AgentSummary } from "./agent-grid-view";

export function AgentCard({ agent }: { agent: AgentSummary }) {
  const { emoji } = useAgentEmoji(agent.id);
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
        {archived ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            보관됨
          </span>
        ) : null}
      </div>

      <div className="mt-3 min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{agent.name}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {agent.description || "설명이 없어요."}
        </p>
      </div>
    </Link>
  );
}
