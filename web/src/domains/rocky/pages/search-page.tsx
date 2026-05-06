import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Bot, ListTodo, Sparkles, X } from "lucide-react";

import { useAgentsQuery } from "@/domains/agent/hooks";
import type { AgentRecord } from "@/domains/agent/types";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { readAllTaskAgentMap } from "@/domains/agent/lib/task-agent-store";
import { resolveRockyChatAgentId } from "@/domains/agent/lib/agent-task-summary";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import {
  formatRockyTaskDateTime,
  getRockyTaskLastActivityAt,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskSummary,
  getRockyTaskTemplateGroup,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import { useMdTemplates } from "@/domains/template/hooks";
import type { MdTemplateDefinition } from "@/domains/template/types";
import type { RockyChatRecord } from "@/domains/rocky/types";
import { PageContainer } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { cn } from "@/shared/lib/utils";

const TABS = [
  { value: "tasks", label: "작업 기록", icon: ListTodo },
  { value: "skills", label: "스킬", icon: Sparkles },
  { value: "agents", label: "에이전트", icon: Bot },
] as const;

type SearchTab = (typeof TABS)[number]["value"];

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function templateMatches(template: MdTemplateDefinition, query: string): boolean {
  if (!query) {
    return true;
  }

  return [
    template.title,
    template.description,
    template.triggerLabel,
    template.outputFormatLabel,
    ...template.requiredInputs,
  ].some((value) => normalized(value).includes(query));
}

function chatMatches(
  chat: RockyChatRecord,
  templates: MdTemplateDefinition[],
  query: string,
): boolean {
  if (!query) {
    return true;
  }

  const group = getRockyTaskTemplateGroup(chat, templates);
  return [
    chat.title,
    group.label,
    getRockyTaskRequest(chat),
    getRockyTaskSummary(chat),
  ].some((value) => normalized(value).includes(query));
}

function agentMatches(agent: AgentRecord, query: string): boolean {
  if (!query) {
    return true;
  }

  return [agent.name, agent.description].some((value) => normalized(value).includes(query));
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const tabParam = searchParams.get("tab");
  const userPickedTab: SearchTab | null = TABS.some((tab) => tab.value === tabParam)
    ? (tabParam as SearchTab)
    : null;
  const normalizedQuery = normalized(query);

  function setActiveTab(next: string) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", next);
    setSearchParams(nextParams, { replace: true });
  }

  function clearQuery() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("q");
    setSearchParams(nextParams, { replace: true });
  }

  const { userTemplates } = useMdTemplates();
  const rockyChatsQuery = useRockyChatsQuery();
  const agentsQuery = useAgentsQuery({ includeArchived: true });
  const chats = rockyChatsQuery.data ?? [];
  const allAgents = useMemo(
    () => filterUserManagedAgents(agentsQuery.data ?? []),
    [agentsQuery.data],
  );
  const agents = useMemo(
    () => allAgents.filter((agent) => agent.lifecycle === "active"),
    [allAgents],
  );

  const taskResults = useMemo(
    () =>
      chats
        .filter((chat) => chatMatches(chat, userTemplates, normalizedQuery))
        .sort((left, right) =>
          getRockyTaskLastActivityAt(right).localeCompare(getRockyTaskLastActivityAt(left)),
        ),
    [chats, normalizedQuery, userTemplates],
  );
  const skillResults = useMemo(
    () => userTemplates.filter((template) => templateMatches(template, normalizedQuery)),
    [normalizedQuery, userTemplates],
  );
  const agentResults = useMemo(
    () => agents.filter((agent) => agentMatches(agent, normalizedQuery)),
    [agents, normalizedQuery],
  );

  // If user hasn't explicitly picked a tab, default to the first tab that has results.
  // Falls back to "tasks" when everything is empty.
  const autoTab: SearchTab = (() => {
    if (taskResults.length > 0) return "tasks";
    if (skillResults.length > 0) return "skills";
    if (agentResults.length > 0) return "agents";
    return "tasks";
  })();
  const activeTab: SearchTab = userPickedTab ?? autoTab;

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          {query ? <>‘{query}’ 검색 결과</> : <>검색</>}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          에이전트나 스킬, 작업 기록을 검색하세요. 상단 검색창에서 키워드를 입력해 결과를 좁힐 수 있습니다.
        </p>
        {query ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={clearQuery}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-3 py-1 text-xs text-foreground transition hover:bg-muted"
            >
              <span>{query}</span>
              <X className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        ) : null}
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
        <TabsList variant="line">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const count =
              tab.value === "tasks"
                ? taskResults.length
                : tab.value === "skills"
                  ? skillResults.length
                  : agentResults.length;

            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                <Icon className="size-4" />
                {tab.label}
                <Badge
                  variant="outline"
                  className="ml-1 h-5 border-border bg-muted px-1.5 text-[10px] text-muted-foreground"
                >
                  {count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="tasks">
          <TaskResults
            chats={taskResults}
            templates={userTemplates}
            agents={allAgents}
            isLoading={rockyChatsQuery.isLoading}
            query={normalizedQuery}
          />
        </TabsContent>
        <TabsContent value="skills">
          <SkillResults templates={skillResults} query={normalizedQuery} />
        </TabsContent>
        <TabsContent value="agents">
          <AgentResults
            agents={agentResults}
            isLoading={agentsQuery.isLoading}
            query={normalizedQuery}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function TaskResults({
  chats,
  templates,
  agents,
  isLoading,
  query,
}: {
  chats: RockyChatRecord[];
  templates: MdTemplateDefinition[];
  agents: AgentRecord[];
  isLoading: boolean;
  query: string;
}) {
  if (isLoading) {
    return <EmptyState message="작업 기록을 불러오는 중입니다." />;
  }

  if (chats.length === 0) {
    return (
      <EmptyState
        message={query ? "일치하는 작업 기록이 없습니다." : "아직 작업 기록이 없습니다."}
      />
    );
  }

  const taskAgentMap = readAllTaskAgentMap();

  return (
    <ul className="grid gap-2">
      {chats.map((chat) => {
        const agentId = resolveRockyChatAgentId(chat, taskAgentMap);
        const agent = agentId ? agents.find((entry) => entry.id === agentId) ?? null : null;
        return (
          <li key={chat.id}>
            <TaskSearchResult
              chat={chat}
              templates={templates}
              agent={agent}
            />
          </li>
        );
      })}
    </ul>
  );
}

function TaskSearchResult({
  chat,
  templates,
  agent,
}: {
  chat: RockyChatRecord;
  templates: MdTemplateDefinition[];
  agent: AgentRecord | null;
}) {
  const status = getRockyTaskStatus(chat);
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
      to={`/tasks/${encodeURIComponent(chat.id)}`}
      style={tinted}
      className="block rounded-lg border bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
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
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  rockyTaskStatusTone(status),
                )}
              >
                {rockyTaskStatusLabel(status)}
              </span>
              {skillTheme ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    skillTheme.chip,
                  )}
                >
                  {skill?.triggerLabel ?? group.label}
                </span>
              ) : (
                <Badge
                  variant="outline"
                  className="h-6 border-border bg-muted px-2 text-[11px] text-muted-foreground"
                >
                  {group.label}
                </Badge>
              )}
            </div>
            <h3 className="mt-2 truncate text-sm font-semibold text-foreground">
              {chat.title || getRockyTaskRequest(chat) || "제목 없음"}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {getRockyTaskSummary(chat)}
            </p>
            <div className="mt-2 text-[11px] text-muted-foreground">
              {formatRockyTaskDateTime(getRockyTaskLastActivityAt(chat))}
            </div>
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}

function SkillResults({
  templates,
  query,
}: {
  templates: MdTemplateDefinition[];
  query: string;
}) {
  if (templates.length === 0) {
    return (
      <EmptyState
        message={query ? "일치하는 스킬이 없습니다." : "아직 등록된 스킬이 없습니다."}
      />
    );
  }

  return (
    <ul className="grid gap-2">
      {templates.map((template) => (
        <li key={template.id}>
          <SkillSearchResult template={template} />
        </li>
      ))}
    </ul>
  );
}

function SkillSearchResult({ template }: { template: MdTemplateDefinition }) {
  const theme = skillKindTheme(template);
  const Icon = theme.Icon;

  return (
    <Link
      to={`/skills/${encodeURIComponent(template.id)}`}
      className="block rounded-lg border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", theme.icon)}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                theme.chip,
              )}
            >
              {template.triggerLabel}
            </span>
            <h3 className="mt-2 truncate text-sm font-semibold text-foreground">
              {template.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {template.description}
            </p>
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}

function AgentResults({
  agents,
  isLoading,
  query,
}: {
  agents: AgentRecord[];
  isLoading: boolean;
  query: string;
}) {
  if (isLoading) {
    return <EmptyState message="에이전트를 불러오는 중입니다." />;
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        message={query ? "일치하는 에이전트가 없습니다." : "아직 활성 에이전트가 없습니다."}
      />
    );
  }

  return (
    <ul className="grid gap-2">
      {agents.map((agent) => (
        <li key={agent.id}>
          <AgentSearchResult agent={agent} />
        </li>
      ))}
    </ul>
  );
}

function AgentSearchResult({ agent }: { agent: AgentRecord }) {
  const { emoji } = useAgentEmoji(agent.id);
  const tinted = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 6%, var(--card))`,
      }
    : undefined;

  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      className="block rounded-lg border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      style={tinted}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <AgentAvatar emoji={emoji} color={agent.color} size="md" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {agent.name}
            </h3>
            {agent.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {agent.description}
              </p>
            ) : null}
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
