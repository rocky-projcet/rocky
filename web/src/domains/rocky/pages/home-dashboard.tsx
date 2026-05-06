import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Plus,
  Sparkles,
  Trophy,
} from "lucide-react";

import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import {
  formatRockyTaskDateTime,
  getRockyTaskLastActivityAt,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskTemplateGroup,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { useMdTemplates } from "@/domains/template/hooks";
import { useAgentsQuery } from "@/domains/agent/hooks";
import { runQueryKeys } from "@/domains/run/hooks";
import type { AgentRecord } from "@/domains/agent/types";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { readAllTaskAgentMap } from "@/domains/agent/lib/task-agent-store";
import { resolveRockyChatAgentId } from "@/domains/agent/lib/agent-task-summary";
import { formatFileSize } from "@/domains/session/lib/attachment-files";
import {
  buildRecentSavedFiles,
  collectRecentSavedFileRunContexts,
  type RecentSavedFile,
} from "@/domains/rocky/lib/home-recent-files";
import type { MdTemplateDefinition } from "@/domains/template/types";
import type { RockyChatRecord, RockyMessageRecord } from "@/domains/rocky/types";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { agentEngineClient } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/utils";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";

const MAX_COUNT = 3;
const MAX_RECENT_FILE_RUNS = 20;

function SkillCard({ template }: { template: MdTemplateDefinition }) {
  const theme = skillKindTheme(template);
  const Icon = theme.Icon;

  return (
    <Link
      to={`/skills/${encodeURIComponent(template.id)}`}
      className="group flex h-full flex-col justify-between rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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
        4단계 질문에 답하면 새 스킬이 만들어져요.
      </p>
    </Link>
  );
}

function NewAgentCard() {
  return (
    <Link
      to="/agents/new"
      className="group flex h-full min-h-[148px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/70 bg-muted/30 p-4 text-center no-underline transition hover:border-primary/50 hover:bg-muted/60"
    >
      <div className="flex size-10 items-center justify-center rounded-xl bg-background text-muted-foreground transition group-hover:text-primary">
        <Plus className="size-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">새로운 나만의 에이전트 만들기</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        이름·이모지·스킬을 골라 캐릭터를 만들어요.
      </p>
    </Link>
  );
}

function FrequentSkillsSection() {
  const { activeTemplates: userTemplates } = useMdTemplates();
  const skills = useMemo(() => {
    return [...userTemplates]
      .sort((left, right) => {
        const leftAt = left.updatedAt ?? left.createdAt ?? "";
        const rightAt = right.updatedAt ?? right.createdAt ?? "";
        return rightAt.localeCompare(leftAt);
      })
      .slice(0, MAX_COUNT);
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {skills.map((template) => (
          <SkillCard key={template.id} template={template} />
        ))}
        <NewSkillCard />
      </div>
    </section>
  );
}

function getLatestSnippet(chat: RockyChatRecord): { who: "rocky" | "user"; text: string } | null {
  const reversed = [...chat.messages].reverse();
  const rockyMessage = reversed.find(
    (message: RockyMessageRecord) => message.role === "rocky" && message.text.trim(),
  );
  if (rockyMessage) {
    return { who: "rocky", text: rockyMessage.text.trim() };
  }
  const userMessage = reversed.find(
    (message: RockyMessageRecord) => message.role === "user" && message.text.trim(),
  );
  if (userMessage) {
    return { who: "user", text: userMessage.text.trim() };
  }
  return null;
}

function compactSnippet(value: string, max = 80): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

function RecentTaskCard({
  chat,
  templates,
  agents,
  taskAgentMap,
}: {
  chat: RockyChatRecord;
  templates: MdTemplateDefinition[];
  agents: AgentRecord[];
  taskAgentMap: Record<string, string>;
}) {
  const status = getRockyTaskStatus(chat);
  const group = getRockyTaskTemplateGroup(chat, templates);
  const skill = templates.find((entry) => entry.id === group.id) ?? null;
  const skillTheme = skill ? skillKindTheme(skill) : null;
  const agentId = resolveRockyChatAgentId(chat, taskAgentMap);
  const agent = agentId ? agents.find((entry) => entry.id === agentId) ?? null : null;
  const { emoji } = useAgentEmoji(agent?.id);

  const snippet = getLatestSnippet(chat);
  const requestText = getRockyTaskRequest(chat);

  const agentTinted = agent?.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
        boxShadow: `0 0 0 1px color-mix(in srgb, ${agent.color} 12%, transparent)`,
      }
    : undefined;

  return (
    <Link
      to={`/tasks/${encodeURIComponent(chat.id)}`}
      style={agentTinted}
      className="block h-full rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {agent ? (
            <AgentAvatar emoji={emoji} color={agent.color} size="md" />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
              <Sparkles className="size-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {agent?.name ?? "Rocky"}
            </p>
            {skillTheme ? (
              <span
                className={cn(
                  "mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  skillTheme.chip,
                )}
              >
                {skill?.triggerLabel ?? group.label}
              </span>
            ) : (
              <Badge
                variant="outline"
                className="mt-0.5 h-4 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
              >
                {group.label}
              </Badge>
            )}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
            rockyTaskStatusTone(status),
          )}
        >
          {rockyTaskStatusLabel(status)}
        </span>
      </div>

      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-foreground">
        {chat.title || requestText || "제목 없음"}
      </h3>
      {snippet ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground/70">
            {snippet.who === "rocky" ? "답변" : "요청"}·
          </span>
          {compactSnippet(snippet.text)}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatRockyTaskDateTime(getRockyTaskLastActivityAt(chat))}</span>
        <ArrowRight className="size-4" />
      </div>
    </Link>
  );
}

function RecentTasksSection() {
  const { userTemplates } = useMdTemplates();
  const chatsQuery = useRockyChatsQuery();
  const agentsQuery = useAgentsQuery({ includeArchived: true });

  const tasks = useMemo(() => {
    const all = chatsQuery.data ?? [];
    return [...all]
      .sort((left, right) =>
        getRockyTaskLastActivityAt(right).localeCompare(getRockyTaskLastActivityAt(left))
      )
      .slice(0, MAX_COUNT);
  }, [chatsQuery.data]);

  const agents = useMemo(
    () => filterUserManagedAgents(agentsQuery.data ?? []),
    [agentsQuery.data],
  );

  const taskAgentMap = useMemo(() => readAllTaskAgentMap(), [tasks]);

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">가장 최근 작업</h2>
        </div>
      </header>

      {chatsQuery.isLoading ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          최근 작업을 불러오는 중입니다.
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            아직 작업 기록이 없어요. 내 에이전트에서 첫 작업을 시작해보세요.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((chat) => (
            <li key={chat.id}>
              <RecentTaskCard
                chat={chat}
                templates={userTemplates}
                agents={agents}
                taskAgentMap={taskAgentMap}
              />
            </li>
          ))}
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
      .slice(0, MAX_COUNT);
  }, [agentsQuery.data, chatsQuery.data]);

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">우수 에이전트</h2>
        </div>
        <Button size="sm" render={<Link to="/agents" />}>
          전체 보기
          <ArrowRight className="size-4" />
        </Button>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ranked.map(({ agent, count }, index) => (
          <li key={agent.id}>
            <TopAgentCard agent={agent} count={count} rank={index + 1} />
          </li>
        ))}
        <li>
          <NewAgentCard />
        </li>
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
        ) : null}
      </div>
      <h3 className="mt-3 truncate text-sm font-semibold text-foreground">{agent.name}</h3>
      <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        완료 {count}회
      </div>
    </Link>
  );
}

function recentFileOpenHref(file: RecentSavedFile): string {
  const artifact = file.artifact;
  const target =
    artifact.preferredAction === "preview" && artifact.previewUrl
      ? artifact.previewUrl
      : artifact.downloadUrl;

  return agentEngineClient.resolveApiPath(target);
}

function RecentFileCard({ file }: { file: RecentSavedFile }) {
  const sizeLabel =
    typeof file.artifact.size === "number" ? formatFileSize(file.artifact.size) : null;
  const detail = [file.displayPath, sizeLabel].filter(Boolean).join(" · ");

  return (
    <li className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {file.artifact.name}
            </h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {detail || file.artifact.contentType}
            </p>
            <p className="mt-2 truncate text-[11px] text-muted-foreground">
              {file.chatTitle}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="h-5 shrink-0 border-border bg-muted px-2 text-[10px] text-muted-foreground"
        >
          저장됨
        </Badge>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {formatRockyTaskDateTime(file.savedAt)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            render={<Link to={`/tasks/${encodeURIComponent(file.chatId)}`} />}
          >
            작업
            <ArrowRight className="size-3" />
          </Button>
          <Button
            size="xs"
            render={
              <a
                href={recentFileOpenHref(file)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            {file.artifact.preferredAction === "preview" && file.artifact.previewUrl ? (
              <ExternalLink className="size-3" />
            ) : (
              <Download className="size-3" />
            )}
            열기
          </Button>
        </div>
      </div>
    </li>
  );
}

function RecentFilesSection() {
  const chatsQuery = useRockyChatsQuery();
  const runContexts = useMemo(
    () =>
      collectRecentSavedFileRunContexts(
        chatsQuery.data ?? [],
        MAX_RECENT_FILE_RUNS
      ),
    [chatsQuery.data],
  );
  const artifactQueries = useQueries({
    queries: runContexts.map((context) => ({
      queryKey: runQueryKeys.runArtifacts(context.runId),
      queryFn: () => agentEngineClient.listRunArtifacts(context.runId),
      staleTime: 30_000,
    })),
  });

  const artifactsByRunId = new Map(
    runContexts.map((context, index) => [
      context.runId,
      artifactQueries[index]?.data ?? [],
    ])
  );
  const files = buildRecentSavedFiles(
    runContexts,
    artifactsByRunId,
    MAX_COUNT
  );
  const isLoading =
    chatsQuery.isLoading || artifactQueries.some((query) => query.isLoading);
  const isError =
    chatsQuery.isError || artifactQueries.some((query) => query.isError);

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">최근 저장된 파일</h2>
        </div>
      </header>

      {isLoading && files.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
          최근 저장된 파일을 불러오는 중입니다.
        </div>
      ) : isError && files.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center">
          <p className="text-sm text-destructive">
            최근 저장된 파일을 불러오지 못했습니다.
          </p>
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            작업이 끝나면 결과 파일 최대 {MAX_COUNT}개가 여기에 모입니다.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {files.map((file) => (
            <RecentFileCard key={file.id} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function HomeDashboard() {
  return (
    <PageContainer>
      <PageHeader
        title="오늘 어떤 일을 부탁해볼까요?"
        description="가장 최근 작업과 자주 쓰는 스킬을 한눈에 보고, 내 에이전트로 새 일을 부탁해보세요."
      />
      <div data-tour="recent-tasks">
        <RecentTasksSection />
      </div>
      <div data-tour="frequent-skills">
        <FrequentSkillsSection />
      </div>
      <div data-tour="top-agents">
        <TopAgentsSection />
      </div>
      <div data-tour="recent-files">
        <RecentFilesSection />
      </div>
    </PageContainer>
  );
}
