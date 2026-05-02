import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  FileInput,
  FileOutput,
  ListTodo,
  Loader2,
  Sparkles,
} from "lucide-react";

import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import {
  formatRockyTaskDateTime,
  formatRockyTaskDuration,
  getRockyTaskEndedAt,
  getRockyTaskExpectedOutputFiles,
  getRockyTaskInputFiles,
  getRockyTaskRequest,
  getRockyTaskStartedAt,
  getRockyTaskStatus,
  getRockyTaskSummary,
  getRockyTaskTemplateGroup,
  isRockyTaskActive,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import type { RockyChatRecord } from "@/domains/rocky/types";
import { useMdTemplates } from "@/domains/template/hooks";
import { useAgentsQuery } from "@/domains/agent/hooks";
import type { AgentRecord } from "@/domains/agent/types";
import type { MdTemplateDefinition } from "@/domains/template/types";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { readAllTaskAgentMap } from "@/domains/agent/lib/task-agent-store";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";
import { PageContainer, PageHeader } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

const ALL_TAB = "all";
const NO_AGENT_TAB = "rocky";

function fileNamesLabel(names: string[], emptyLabel: string): string {
  if (names.length === 0) {
    return emptyLabel;
  }

  const visible = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${visible} 외 ${names.length - 2}개` : visible;
}

function TaskMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTab = searchParams.get("agent") ?? ALL_TAB;
  const { userTemplates } = useMdTemplates();
  const rockyChatsQuery = useRockyChatsQuery();
  const agentsQuery = useAgentsQuery({ includeArchived: true });

  const chats = rockyChatsQuery.data ?? [];
  const sortedChats = useMemo(
    () => [...chats].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [chats],
  );
  const taskAgentMap = useMemo(() => readAllTaskAgentMap(), [chats]);
  const agents = useMemo(
    () => filterUserManagedAgents(agentsQuery.data ?? []),
    [agentsQuery.data],
  );

  const agentsWithTasks = useMemo(() => {
    const ids = new Set(sortedChats.map((chat) => taskAgentMap[chat.id]).filter(Boolean));
    return agents.filter((agent) => ids.has(agent.id));
  }, [sortedChats, agents, taskAgentMap]);

  const hasUnmapped = useMemo(
    () => sortedChats.some((chat) => !taskAgentMap[chat.id]),
    [sortedChats, taskAgentMap],
  );

  const visibleChats = useMemo(() => {
    if (selectedTab === ALL_TAB) return sortedChats;
    if (selectedTab === NO_AGENT_TAB) {
      return sortedChats.filter((chat) => !taskAgentMap[chat.id]);
    }
    return sortedChats.filter((chat) => taskAgentMap[chat.id] === selectedTab);
  }, [selectedTab, sortedChats, taskAgentMap]);

  const activeChats = sortedChats.filter(isRockyTaskActive);

  function setTab(next: string) {
    if (next === ALL_TAB) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("agent");
      setSearchParams(nextParams, { replace: true });
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("agent", next);
    setSearchParams(nextParams, { replace: true });
  }

  const selectedAgent = useMemo(
    () =>
      selectedTab !== ALL_TAB && selectedTab !== NO_AGENT_TAB
        ? agents.find((agent) => agent.id === selectedTab) ?? null
        : null,
    [selectedTab, agents],
  );

  return (
    <PageContainer>
      <PageHeader
        title="작업 목록"
        description="에이전트별로 작업을 모아보세요. 카드를 누르면 상세 화면으로 이동합니다."
      />

      <AgentTabs
        agents={agentsWithTasks}
        selected={selectedTab}
        totalCount={sortedChats.length}
        unmappedCount={hasUnmapped ? sortedChats.filter((chat) => !taskAgentMap[chat.id]).length : 0}
        countByAgent={Object.fromEntries(
          agentsWithTasks.map((agent) => [
            agent.id,
            sortedChats.filter((chat) => taskAgentMap[chat.id] === agent.id).length,
          ]),
        )}
        onSelect={setTab}
      />

      {selectedAgent ? <NewTaskForAgentRow agent={selectedAgent} /> : null}

      {activeChats.length > 0 ? (
        <section className="rounded-lg border bg-amber-500/6 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Loader2 className="size-4 animate-spin text-amber-600" />
            진행중인 작업
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {activeChats.slice(0, 3).map((chat) => (
              <Link
                key={chat.id}
                to={`/tasks/${encodeURIComponent(chat.id)}`}
                className="rounded-md border bg-background px-3 py-2 text-sm transition hover:border-foreground/40"
              >
                <div className="truncate font-medium text-foreground">
                  {chat.title || getRockyTaskRequest(chat)}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {getRockyTaskSummary(chat)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        {rockyChatsQuery.isLoading ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            작업 목록을 불러오는 중입니다.
          </div>
        ) : visibleChats.length > 0 ? (
          visibleChats.map((chat) => (
            <TaskCard
              key={chat.id}
              chat={chat}
              agent={
                taskAgentMap[chat.id]
                  ? agents.find((a) => a.id === taskAgentMap[chat.id]) ?? null
                  : null
              }
              templates={userTemplates}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
            <div className="text-sm font-medium text-foreground">표시할 작업이 없습니다.</div>
            <p className="mt-1 text-xs text-muted-foreground">
              내 에이전트 화면에서 작업을 시작하면 이곳에 쌓입니다.
            </p>
            <Button
              className="mt-4"
              size="sm"
              nativeButton={false}
              render={<Link to="/agents" />}
            >
              내 에이전트로 가기
            </Button>
          </div>
        )}
      </section>
    </PageContainer>
  );
}

function AgentTabs({
  agents,
  selected,
  totalCount,
  unmappedCount,
  countByAgent,
  onSelect,
}: {
  agents: AgentRecord[];
  selected: string;
  totalCount: number;
  unmappedCount: number;
  countByAgent: Record<string, number>;
  onSelect: (next: string) => void;
}) {
  return (
    <section className="flex flex-wrap gap-2">
      <TabButton
        active={selected === ALL_TAB}
        count={totalCount}
        onClick={() => onSelect(ALL_TAB)}
      >
        <ListTodo className="size-3.5" />
        전체
      </TabButton>
      {agents.map((agent) => (
        <AgentTabButton
          key={agent.id}
          agent={agent}
          active={selected === agent.id}
          count={countByAgent[agent.id] ?? 0}
          onClick={() => onSelect(agent.id)}
        />
      ))}
      {unmappedCount > 0 ? (
        <TabButton
          active={selected === NO_AGENT_TAB}
          count={unmappedCount}
          onClick={() => onSelect(NO_AGENT_TAB)}
        >
          <Sparkles className="size-3.5" />
          매핑 없음
        </TabButton>
      ) : null}
    </section>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
      {typeof count === "number" ? (
        <span
          className={cn(
            "ml-0.5 text-[10px]",
            active ? "text-background/80" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function AgentTabButton({
  agent,
  active,
  count,
  onClick,
}: {
  agent: AgentRecord;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const { emoji } = useAgentEmoji(agent.id);
  const tinted = !active && agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 36%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 8%, var(--background))`,
      }
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      style={tinted}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      <span className="text-sm leading-none">{emoji}</span>
      <span className="truncate">{agent.name}</span>
      <span
        className={cn(
          "ml-0.5 text-[10px]",
          active ? "text-background/80" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function TaskCard({
  chat,
  agent,
  templates,
}: {
  chat: RockyChatRecord;
  agent: AgentRecord | null;
  templates: MdTemplateDefinition[];
}) {
  const status = getRockyTaskStatus(chat);
  const inputFiles = getRockyTaskInputFiles(chat);
  const expectedOutputFiles = getRockyTaskExpectedOutputFiles(chat);
  const startedAt = getRockyTaskStartedAt(chat);
  const endedAt = getRockyTaskEndedAt(chat);
  const taskHref = `/tasks/${encodeURIComponent(chat.id)}`;
  const outputLabel =
    expectedOutputFiles.length > 0
      ? fileNamesLabel(expectedOutputFiles, "지정 없음")
      : status === "completed"
        ? "결과 메시지"
        : "아직 없음";

  const group = getRockyTaskTemplateGroup(chat, templates);
  const skill = templates.find((entry) => entry.id === group.id) ?? null;
  const skillTheme = skill ? skillKindTheme(skill) : null;

  const { emoji } = useAgentEmoji(agent?.id);
  const tinted = agent?.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
      }
    : undefined;

  return (
    <Link
      to={taskHref}
      style={tinted}
      className="block rounded-lg border bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
    >
      <article>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {agent ? (
              <AgentAvatar emoji={emoji} color={agent.color} size="md" />
            ) : (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted text-muted-foreground">
                <Sparkles className="size-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {agent?.name ?? "Rocky"}
                </span>
                <Badge
                  variant="outline"
                  className={cn("h-5 border px-1.5 text-[10px]", rockyTaskStatusTone(status))}
                >
                  {rockyTaskStatusLabel(status)}
                </Badge>
                {skillTheme ? (
                  <span
                    className={cn(
                      "inline-flex h-5 items-center rounded-full border px-1.5 text-[10px] font-medium",
                      skillTheme.chip,
                    )}
                  >
                    {skill?.triggerLabel ?? group.label}
                  </span>
                ) : (
                  <Badge
                    variant="outline"
                    className="h-5 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
                  >
                    {group.label}
                  </Badge>
                )}
              </div>
              <h3 className="mt-2 truncate text-base font-semibold text-foreground">
                {chat.title || getRockyTaskRequest(chat)}
              </h3>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {getRockyTaskSummary(chat)}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            nativeButton={false}
            onClick={(event) => event.stopPropagation()}
            render={<Link to={taskHref} />}
          >
            열기
            <ArrowRight className="size-4" />
          </Button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <TaskMetric
            icon={<Clock3 className="size-3.5" />}
            label="최근 업데이트"
            value={formatRockyTaskDateTime(chat.updatedAt)}
          />
          <TaskMetric
            icon={<Clock3 className="size-3.5" />}
            label="소요 시간"
            value={formatRockyTaskDuration(startedAt, endedAt)}
          />
          <TaskMetric
            icon={<FileInput className="size-3.5" />}
            label={`input ${inputFiles.length}개`}
            value={fileNamesLabel(inputFiles.map((file) => file.name), "없음")}
          />
          <TaskMetric
            icon={<FileOutput className="size-3.5" />}
            label={`output ${expectedOutputFiles.length}개`}
            value={outputLabel}
          />
        </div>
      </article>
    </Link>
  );
}

function NewTaskForAgentRow({ agent }: { agent: AgentRecord }) {
  const { emoji } = useAgentEmoji(agent.id);
  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      className="group flex items-center gap-3 rounded-2xl border-2 border-dashed border-border/70 bg-muted/30 px-4 py-3 no-underline transition hover:border-primary/50 hover:bg-muted/60"
    >
      <AgentAvatar emoji={emoji} color={agent.color} size="md" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase text-muted-foreground">
          새 작업
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
          {agent.name}에게 새로운 작업 부탁하기
        </div>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
    </Link>
  );
}
