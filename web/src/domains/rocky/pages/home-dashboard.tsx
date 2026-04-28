import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, FileText, Plus, Sparkles, Trophy, Zap } from "lucide-react";

import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import {
  formatRockyTaskDateTime,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskTemplateGroup,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { useMdTemplates } from "@/domains/template/hooks";
import { useAgentsQuery } from "@/domains/agent/hooks";
import type { AgentRecord } from "@/domains/agent/types";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { readAllTaskAgentMap } from "@/domains/agent/lib/task-agent-store";
import type { MdTemplateDefinition } from "@/domains/template/types";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";

const FREQUENT_SKILL_LIMIT = 7;
const RECENT_TASK_LIMIT = 6;

function SkillCard({ template }: { template: MdTemplateDefinition }) {
  const theme = skillKindTheme(template);
  const Icon = theme.Icon;

  return (
    <Link
      to={`/skills/${encodeURIComponent(template.id)}`}
      className="group flex h-full flex-col justify-between rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:border-foreground/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", theme.icon)}>
          <Icon className="size-4" />
        </div>
        <span
          className={cn(
            "inline-flex max-w-[60%] items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium",
            theme.chip,
          )}
          title={template.triggerLabel}
        >
          <span className="block truncate">{template.triggerLabel}</span>
        </span>
      </div>
      <div className="mt-3 min-w-0">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {template.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {template.description}
        </p>
      </div>
    </Link>
  );
}

function NewSkillCard() {
  return (
    <Link
      to="/skills/new"
      className="group flex h-full min-h-[148px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/70 bg-muted/30 p-4 text-center no-underline transition hover:border-primary/50 hover:bg-muted/60"
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-background text-muted-foreground transition group-hover:text-primary">
        <Plus className="size-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">새 스킬 만들기</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Rocky가 몇 가지 질문으로 새 업무를 정리합니다.
      </p>
    </Link>
  );
}

function FrequentSkillsSection() {
  const { userTemplates } = useMdTemplates();
  const skills = useMemo(() => {
    return [...userTemplates]
      .sort((left, right) => {
        const leftAt = left.updatedAt ?? left.createdAt ?? "";
        const rightAt = right.updatedAt ?? right.createdAt ?? "";
        return rightAt.localeCompare(leftAt);
      })
      .slice(0, FREQUENT_SKILL_LIMIT);
  }, [userTemplates]);

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">자주 쓰는 스킬</h2>
        </div>
        <Button size="sm" render={<Link to="/skills" />}>
          전체 보기
          <ArrowRight className="size-4" />
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {skills.map((template) => (
          <SkillCard key={template.id} template={template} />
        ))}
        <NewSkillCard />
      </div>
    </section>
  );
}

function RecentTasksSection() {
  const { userTemplates } = useMdTemplates();
  const chatsQuery = useRockyChatsQuery();
  const tasks = useMemo(() => {
    const all = chatsQuery.data ?? [];
    return [...all]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, RECENT_TASK_LIMIT);
  }, [chatsQuery.data]);

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">가장 최근 작업</h2>
        </div>
      </header>

      {chatsQuery.isLoading ? (
        <Card className="bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
          최근 작업을 불러오는 중입니다.
        </Card>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            아직 작업 기록이 없습니다. 위에서 스킬을 골라 첫 작업을 시작하세요.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {tasks.map((chat) => {
            const status = getRockyTaskStatus(chat);
            const group = getRockyTaskTemplateGroup(chat, userTemplates);
            const request = getRockyTaskRequest(chat);

            return (
              <li key={chat.id}>
                <Link
                  to={`/tasks/${encodeURIComponent(chat.id)}`}
                  className="flex items-start justify-between gap-4 px-4 py-3 no-underline transition hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="h-5 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
                      >
                        {group.label}
                      </Badge>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                          rockyTaskStatusTone(status),
                        )}
                      >
                        {rockyTaskStatusLabel(status)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-foreground">
                      {chat.title || request || "제목 없음"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatRockyTaskDateTime(chat.updatedAt)}</span>
                    <ArrowRight className="size-4" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TopAgentsSection() {
  const agentsQuery = useAgentsQuery();
  const chatsQuery = useRockyChatsQuery();

  const ranked = useMemo(() => {
    const agents = filterUserManagedAgents(agentsQuery.data ?? []).filter(
      (agent) => agent.lifecycle === "active",
    );
    if (agents.length === 0) return [];

    const taskAgentMap = readAllTaskAgentMap();
    const counts: Record<string, number> = {};
    for (const chat of chatsQuery.data ?? []) {
      const agentId = taskAgentMap[chat.id];
      if (!agentId) continue;
      if (getRockyTaskStatus(chat) !== "completed") continue;
      counts[agentId] = (counts[agentId] ?? 0) + 1;
    }

    return agents
      .map((agent) => ({ agent, count: counts[agent.id] ?? 0 }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return right.agent.updatedAt.localeCompare(left.agent.updatedAt);
      })
      .slice(0, 4);
  }, [agentsQuery.data, chatsQuery.data]);

  if (ranked.length === 0) {
    return null;
  }

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">우수 에이전트</h2>
        </div>
        <Button size="sm" variant="outline" render={<Link to="/agents" />}>
          전체 보기
          <ArrowRight className="size-4" />
        </Button>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ranked.map(({ agent, count }, index) => (
          <li key={agent.id}>
            <TopAgentCard agent={agent} count={count} rank={index + 1} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopAgentCard({
  agent,
  count,
  rank,
}: {
  agent: AgentRecord;
  count: number;
  rank: number;
}) {
  const { emoji } = useAgentEmoji(agent.id);
  const tinted = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 7%, var(--card))`,
      }
    : undefined;
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;

  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      style={tinted}
      className="block rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <AgentAvatar emoji={emoji} color={agent.color} size="lg" />
        {medal ? (
          <span className="text-xl leading-none" aria-label={`${rank}위`}>
            {medal}
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{rank}위</span>
        )}
      </div>
      <h3 className="mt-3 truncate text-sm font-semibold text-foreground">{agent.name}</h3>
      <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Zap className="size-3.5" />
        완료 {count}회
      </div>
    </Link>
  );
}

function RecentFilesSection() {
  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">최근 저장된 파일</h2>
        </div>
      </header>

      <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          작업이 끝나면 결과 파일이 여기에 모입니다.
        </p>
      </div>
    </section>
  );
}

export function HomeDashboard() {
  return (
    <PageContainer>
      <PageHeader
        title="홈에는 어떤 작업을 요청하실건가요?"
        description="자주 쓰는 스킬을 골라 바로 실행하거나, 새 스킬을 만들어 Rocky에게 맡겨주세요."
      />
      <FrequentSkillsSection />
      <TopAgentsSection />
      <RecentTasksSection />
      <RecentFilesSection />
    </PageContainer>
  );
}
