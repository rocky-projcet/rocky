import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Archive,
  Bot,
  Check,
  Download,
  Eye,
  FileText,
  ListTodo,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import { agentQueryKeys, useAgentsQuery } from "@/domains/agent/hooks";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { readAllTaskAgentMap } from "@/domains/agent/lib/task-agent-store";
import {
  ensureTemplateSkillDefinition,
} from "@/domains/template/lib/md-template-definitions";
import { resolveTemplateSkillInstallFiles } from "@/domains/template/lib/runtime-template-files";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";
import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import { filterUserManagedAgents } from "@/domains/rocky/lib/rocky-agent-catalog";
import {
  formatRockyTaskDateTime,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskSummary,
  isRockyTaskForTemplateSkill,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import { useMdTemplates } from "@/domains/template/hooks";
import type {
  MdTemplateDefinition,
  MdTemplateInputArtifact,
} from "@/domains/template/types";
import { PageContainer } from "@/shared/components/page-container";
import { Button, buttonVariants } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  AgentLocalSkillFileInput,
  AgentRecord,
  RockyChatRecord,
} from "@/shared/lib/agent-engine-client";
import {
  parseXlsxPreview,
  type XlsxPreviewSheet,
} from "@/shared/lib/xlsx-preview";
import { cn } from "@/shared/lib/utils";

export function SkillDetailPage() {
  const navigate = useNavigate();
  const { skillId } = useParams<{ skillId: string }>();
  const queryClient = useQueryClient();
  const { userTemplates, archiveTemplate, updateTemplate } = useMdTemplates();
  const skill = useMemo(
    () => userTemplates.find((entry) => entry.id === skillId) ?? null,
    [skillId, userTemplates],
  );
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [useDialogOpen, setUseDialogOpen] = useState(false);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  const chatsQuery = useRockyChatsQuery();
  const agentsQuery = useAgentsQuery({ includeArchived: true });
  const agents = useMemo(
    () => filterUserManagedAgents(agentsQuery.data ?? []),
    [agentsQuery.data],
  );
  const pickableAgents = useMemo(
    () => agents.filter((agent) => !agent.archivedAt),
    [agents],
  );
  const agentSkillsQueries = useQueries({
    queries: pickableAgents.map((agent) => ({
      queryKey: agentQueryKeys.agentLocalSkills(agent.id),
      queryFn: () => agentEngineClient.listAgentLocalSkills(agent.id),
    })),
  });
  const equippedAgentIdSet = useMemo(() => {
    if (!skill) return new Set<string>();
    const ids = new Set<string>();
    pickableAgents.forEach((agent, index) => {
      const records = agentSkillsQueries[index]?.data;
      if (records?.some((record) => record.id === skill.skill.id)) {
        ids.add(agent.id);
      }
    });
    return ids;
  }, [pickableAgents, agentSkillsQueries, skill]);
  const equippedAgents = useMemo(
    () => pickableAgents.filter((agent) => equippedAgentIdSet.has(agent.id)),
    [pickableAgents, equippedAgentIdSet],
  );
  const availableAgents = useMemo(
    () => pickableAgents.filter((agent) => !equippedAgentIdSet.has(agent.id)),
    [pickableAgents, equippedAgentIdSet],
  );
  const taskAgentMap = useMemo(
    () => readAllTaskAgentMap(),
    [chatsQuery.data],
  );

  const attachMutation = useMutation({
    mutationFn: async (agentId: string) => {
      if (!skill) {
        throw new Error("스킬 정보를 찾을 수 없습니다.");
      }
      const normalized = ensureTemplateSkillDefinition(skill);
      const result = await agentEngineClient.upsertAgentLocalSkill(
        agentId,
        normalized.skill.id,
        {
          replace: true,
          files: await resolveTemplateSkillInstallFiles(normalized),
        },
      );
      return { agentId, skills: result.skills };
    },
    onSuccess: ({ agentId, skills }) => {
      queryClient.setQueryData(
        agentQueryKeys.agentLocalSkills(agentId),
        skills,
      );
    },
  });

  const tasks = useMemo(() => {
    if (!skill) return [];
    const all = chatsQuery.data ?? [];
    return all
      .filter((chat) => isRockyTaskForTemplateSkill(chat, skill, userTemplates))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [chatsQuery.data, skill, userTemplates]);
  const filteredTasks = useMemo(
    () => filterSkillTasks(tasks, taskSearchQuery, agents, taskAgentMap),
    [agents, taskAgentMap, taskSearchQuery, tasks],
  );

  if (!skill) {
    return <SkillNotFound />;
  }

  function handleArchive() {
    if (!skill) return;
    archiveTemplate(skill.id);
    toast.success("스킬을 보관함으로 옮겼습니다.");
    navigate("/skills", { replace: true });
  }

  const theme = skillKindTheme(skill);
  const ChipIcon = theme.Icon;

  return (
    <PageContainer>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              theme.chip,
            )}
          >
            <ChipIcon className="size-3.5" />
            {skill.triggerLabel}
          </span>
          <div className="mt-3">
            <EditableTitle
              value={skill.title}
              onSave={(next) => updateTemplate(skill.id, { title: next })}
            />
          </div>
          <div className="mt-2 max-w-2xl">
            <EditableDescription
              value={skill.description}
              onSave={(next) => updateTemplate(skill.id, { description: next })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleArchive}>
            <Archive className="size-4" />
            보관
          </Button>
        </div>
      </header>

      <section
        className={cn(
          "rounded-2xl border p-4 text-sm leading-6",
          theme.chip,
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              theme.icon,
            )}
          >
            <Bot className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">이 공용 스킬을 직원에게 장착해 보세요</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              장착하는 순간 그 직원의 사본이 만들어지고, 이후엔 직원 안에서 따로 진화합니다.
            </p>
          </div>
          <Button onClick={() => setUseDialogOpen(true)}>
            <Sparkles className="size-4" />
            직원에게 장착
          </Button>
        </div>
      </section>

      <UseSkillDialog
        open={useDialogOpen}
        onOpenChange={(next) => {
          setUseDialogOpen(next);
          if (!next) setPendingAgentId(null);
        }}
        skill={skill}
        equippedAgents={equippedAgents}
        availableAgents={availableAgents}
        agentsLoading={
          agentsQuery.isLoading || agentSkillsQueries.some((q) => q.isLoading)
        }
        pendingAgentId={pendingAgentId}
        onSelect={async (agentId, needsAttach) => {
          try {
            if (needsAttach) {
              setPendingAgentId(agentId);
              await attachMutation.mutateAsync(agentId);
            }
            setUseDialogOpen(false);
            setPendingAgentId(null);
            navigate(
              `/agents/${encodeURIComponent(agentId)}?skill=${encodeURIComponent(skill.id)}`,
            );
          } catch (error) {
            setPendingAgentId(null);
            toast.error("스킬을 장착하지 못했습니다.", {
              description: error instanceof Error ? error.message : undefined,
            });
          }
        }}
      />

      <SkillSummary skill={skill} />

      <SkillAttachmentSection skill={skill} />

      <section>
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bot className="size-4 text-muted-foreground" />
            이 공용 스킬을 사용 중인 직원
            <span className="text-xs font-normal text-muted-foreground">
              {equippedAgents.length}명
            </span>
          </h2>
        </header>
        {equippedAgents.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            아직 이 공용 스킬을 장착한 직원이 없어요. 위 "직원에게 장착" 버튼으로 시작해 보세요.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {equippedAgents.map((agent) => (
              <li key={agent.id}>
                <UsingAgentCard agent={agent} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListTodo className="size-4 text-muted-foreground" />
            이 공용 스킬로 한 작업
            <span className="text-[11px] font-normal text-muted-foreground">
              (직원 사본 포함)
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {taskSearchQuery.trim()
                ? `${filteredTasks.length}/${tasks.length}개`
                : `${tasks.length}개`}
            </span>
          </h2>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={taskSearchQuery}
              onChange={(event) => setTaskSearchQuery(event.target.value)}
              placeholder="작업 검색"
              aria-label="이 스킬로 한 작업 검색"
              className="pl-9"
            />
          </div>
        </div>

        {chatsQuery.isLoading ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            작업을 불러오는 중입니다.
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            아직 이 스킬로 한 작업이 없습니다.
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            검색 결과가 없습니다.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTasks.map((chat) => {
              const agent = getRockyTaskAgentRecord(chat, agents, taskAgentMap);
              return (
                <SkillTaskCard
                  key={chat.id}
                  chat={chat}
                  agent={agent}
                  agentLabel={getRockyTaskAgentLabel(chat, agents, taskAgentMap)}
                />
              );
            })}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}

type TaskAgentMap = Record<string, string>;

function UseSkillDialog({
  open,
  onOpenChange,
  skill,
  equippedAgents,
  availableAgents,
  agentsLoading,
  pendingAgentId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  skill: MdTemplateDefinition;
  equippedAgents: AgentRecord[];
  availableAgents: AgentRecord[];
  agentsLoading: boolean;
  pendingAgentId: string | null;
  onSelect: (agentId: string, needsAttach: boolean) => void | Promise<void>;
}) {
  const totalAgents = equippedAgents.length + availableAgents.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-6 sm:max-w-2xl min-h-[28rem]">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-lg">사본을 누구에게 줄까요?</DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {`"${skill.title}" 공용 스킬의 사본을 만들어 직원에게 장착합니다. 한 번 장착되면 그 직원 안에서 따로 자라납니다.`}
          </DialogDescription>
        </DialogHeader>

        {agentsLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            에이전트를 불러오는 중입니다.
          </div>
        ) : totalAgents === 0 ? (
          <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            <p>아직 사용할 수 있는 에이전트가 없어요.</p>
            <Link
              to="/agents"
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                "mt-3 inline-flex",
              )}
              onClick={() => onOpenChange(false)}
            >
              <Plus className="size-4" />
              에이전트 만들기
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {equippedAgents.length > 0 ? (
              <section>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Check className="size-3.5" />
                  이 스킬이 장착된 에이전트
                </p>
                <ul className="space-y-1.5">
                  {equippedAgents.map((agent) => (
                    <li key={agent.id}>
                      <AgentChoiceRow
                        agent={agent}
                        kind="equipped"
                        pending={pendingAgentId === agent.id}
                        onSelect={() => onSelect(agent.id, false)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {availableAgents.length > 0 ? (
              <section>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {equippedAgents.length > 0
                    ? "다른 에이전트에 장착해서 사용"
                    : "에이전트에 장착해서 사용"}
                </p>
                <ul className="space-y-1.5">
                  {availableAgents.map((agent) => (
                    <li key={agent.id}>
                      <AgentChoiceRow
                        agent={agent}
                        kind="available"
                        pending={pendingAgentId === agent.id}
                        onSelect={() => onSelect(agent.id, true)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UsingAgentCard({ agent }: { agent: AgentRecord }) {
  const { emoji } = useAgentEmoji(agent.id);
  const tinted = agent.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 28%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 5%, var(--card))`,
      }
    : undefined;
  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.id)}`}
      style={tinted}
      className="block rounded-2xl border border-border/70 bg-card p-3 no-underline shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <AgentAvatar emoji={emoji} color={agent.color} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            이 직원의 사본은 따로 진화 중이에요
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}

function AgentChoiceRow({
  agent,
  kind,
  pending,
  onSelect,
}: {
  agent: AgentRecord;
  kind: "equipped" | "available";
  pending: boolean;
  onSelect: () => void;
}) {
  const { emoji } = useAgentEmoji(agent.id);
  const helper = kind === "equipped" ? "이미 장착됨 · 바로 사용" : "장착 후 사용";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={pending}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left transition",
        "hover:border-foreground/40 hover:bg-muted/40",
        "disabled:cursor-not-allowed disabled:opacity-70",
      )}
    >
      <AgentAvatar emoji={emoji} color={agent.color} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{agent.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{helper}</p>
      </div>
      {pending ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <ArrowRight className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function getRockyTaskAgentId(
  chat: RockyChatRecord,
  taskAgentMap?: TaskAgentMap,
): string | null {
  const mappedAgentId = taskAgentMap?.[chat.id];
  if (mappedAgentId) {
    return mappedAgentId;
  }

  if (chat.worker?.agentId) {
    return chat.worker.agentId;
  }

  for (const dispatch of [...chat.dispatches].reverse()) {
    if (dispatch.orchestration?.agentId) {
      return dispatch.orchestration.agentId;
    }
  }

  return null;
}

function getRockyTaskAgentRecord(
  chat: RockyChatRecord,
  agents: AgentRecord[],
  taskAgentMap?: TaskAgentMap,
): AgentRecord | null {
  const agentId = getRockyTaskAgentId(chat, taskAgentMap);
  if (!agentId) {
    return null;
  }

  return agents.find((agent) => agent.id === agentId) ?? null;
}

function getRockyTaskAgentLabel(
  chat: RockyChatRecord,
  agents: AgentRecord[],
  taskAgentMap?: TaskAgentMap,
): string {
  const agent = getRockyTaskAgentRecord(chat, agents, taskAgentMap);
  if (agent?.name) {
    return agent.name;
  }

  if (chat.worker?.displayName) {
    return chat.worker.displayName;
  }

  const agentId = getRockyTaskAgentId(chat, taskAgentMap);
  return agentId ? `에이전트 ${agentId}` : "에이전트 정보 없음";
}

function filterSkillTasks(
  tasks: RockyChatRecord[],
  query: string,
  agents: AgentRecord[],
  taskAgentMap: TaskAgentMap,
): RockyChatRecord[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return tasks;
  }

  return tasks.filter((chat) => {
    const request = getRockyTaskRequest(chat);
    const summary = getRockyTaskSummary(chat);
    const agentLabel = getRockyTaskAgentLabel(chat, agents, taskAgentMap);
    const haystack = [
      chat.title,
      request,
      summary,
      agentLabel,
      chat.worker?.displayName ?? "",
      getRockyTaskAgentId(chat, taskAgentMap) ?? "",
    ]
      .join("\n")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function SkillTaskCard({
  chat,
  agent,
  agentLabel,
}: {
  chat: RockyChatRecord;
  agent: AgentRecord | null;
  agentLabel: string;
}) {
  const status = getRockyTaskStatus(chat);
  const summary = getRockyTaskSummary(chat);
  const request = getRockyTaskRequest(chat);
  const { emoji } = useAgentEmoji(agent?.id);
  const agentStyle = agent?.color
    ? {
        borderColor: `color-mix(in srgb, ${agent.color} 36%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${agent.color} 8%, var(--card))`,
      }
    : undefined;

  return (
    <li>
      <Link
        to={`/tasks/${encodeURIComponent(chat.id)}`}
        className="block h-full rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
              rockyTaskStatusTone(status),
            )}
          >
            {rockyTaskStatusLabel(status)}
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </div>
        <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-foreground">
          {chat.title || request || "제목 없음"}
        </h3>
        <div
          className={cn(
            "mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
            agent
              ? "border-border bg-muted/40 text-foreground"
              : "border-border/60 bg-muted/40 text-muted-foreground",
          )}
          style={agentStyle}
        >
          {agent ? (
            <AgentAvatar
              emoji={emoji}
              color={agent.color}
              size="sm"
              className="size-5 rounded-lg text-xs shadow-none"
            />
          ) : (
            <Bot className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{agentLabel}</span>
        </div>
        {summary ? (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {summary}
          </p>
        ) : null}
        <div className="mt-3 text-[11px] text-muted-foreground">
          {formatRockyTaskDateTime(chat.updatedAt)}
        </div>
      </Link>
    </li>
  );
}

function SkillSummary({ skill }: { skill: MdTemplateDefinition }) {
  const lines = skill.defaultInstructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-muted/30 p-4">
      <h2 className="text-sm font-semibold text-foreground">스킬 요약</h2>
      <ul className="mt-2 space-y-1 text-sm leading-6 text-muted-foreground">
        {lines.slice(0, 8).map((line, index) => (
          <li key={index} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
            <span className="min-w-0 flex-1">
              {line.replace(/^- /, "")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type SkillAttachmentView = {
  artifact: MdTemplateInputArtifact;
  file: AgentLocalSkillFileInput | null;
};

function baseContentType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isTextLikeAttachment(artifact: MdTemplateInputArtifact): boolean {
  const type = baseContentType(artifact.contentType);
  const name = artifact.fileName.toLowerCase();

  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    /\.(csv|tsv|txt|md|markdown|json|ya?ml|xml|log)$/i.test(name)
  );
}

function isXlsxAttachment(artifact: MdTemplateInputArtifact): boolean {
  const type = baseContentType(artifact.contentType);
  return (
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    artifact.fileName.toLowerCase().endsWith(".xlsx")
  );
}

function decodedAttachmentBytes(file: AgentLocalSkillFileInput): Uint8Array {
  if (file.encoding === "utf8") {
    return new TextEncoder().encode(file.content);
  }

  const binary = atob(file.content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodedAttachmentText(file: AgentLocalSkillFileInput): string {
  if (file.encoding === "utf8") {
    return file.content;
  }

  return new TextDecoder().decode(decodedAttachmentBytes(file));
}

function useAttachmentObjectUrl(
  attachment: SkillAttachmentView | null
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!attachment?.file) {
      setUrl(null);
      return;
    }

    const bytes = decodedAttachmentBytes(attachment.file);
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([body], {
      type: attachment.artifact.contentType ?? "application/octet-stream",
    });
    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);

    return () => URL.revokeObjectURL(nextUrl);
  }, [
    attachment?.artifact.contentType,
    attachment?.artifact.id,
    attachment?.file?.content,
    attachment?.file?.encoding,
    attachment?.file?.path,
  ]);

  return url;
}

function attachmentFileMatches(
  artifact: MdTemplateInputArtifact,
  file: AgentLocalSkillFileInput
): boolean {
  if (artifact.skillPath && file.path === artifact.skillPath) {
    return true;
  }

  const normalizedPath = file.path.toLowerCase();
  const normalizedName = artifact.fileName.toLowerCase();
  return (
    normalizedPath.startsWith("assets/inputs/") &&
    normalizedPath.endsWith(`/${normalizedName}`)
  );
}

function buildSkillAttachmentViews(
  skill: MdTemplateDefinition,
  files: AgentLocalSkillFileInput[]
): SkillAttachmentView[] {
  return (skill.inputArtifacts ?? []).map((artifact) => ({
    artifact,
    file: files.find((file) => attachmentFileMatches(artifact, file)) ?? null,
  }));
}

function columnName(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function SkillAttachmentSheetTable({ sheet }: { sheet: XlsxPreviewSheet }) {
  const visibleColumnCount = Math.min(
    Math.max(sheet.columnCount, ...sheet.rows.map((row) => row.length), 1),
    50
  );

  return (
    <div className="h-full min-h-0 overflow-auto bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-20 w-12 border-b border-r bg-muted px-2 py-2 text-right font-medium">
              #
            </th>
            {Array.from({ length: visibleColumnCount }, (_, index) => (
              <th
                key={index}
                className="min-w-28 border-b border-r px-2 py-2 text-left font-medium"
              >
                {columnName(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-background even:bg-muted/20">
              <th className="sticky left-0 z-10 border-b border-r bg-inherit px-2 py-1.5 text-right font-medium text-muted-foreground">
                {rowIndex + 1}
              </th>
              {Array.from({ length: visibleColumnCount }, (_, columnIndex) => (
                <td
                  key={columnIndex}
                  className="max-w-56 truncate border-b border-r px-2 py-1.5 text-foreground"
                  title={row[columnIndex] ?? ""}
                >
                  {row[columnIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.truncatedRows || sheet.truncatedColumns ? (
        <div className="sticky bottom-0 border-t bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          큰 파일이라 처음 {Math.min(sheet.rowCount, 200)}행,
          {Math.min(sheet.columnCount, 50)}열까지만 표시합니다.
        </div>
      ) : null}
    </div>
  );
}

function SkillAttachmentXlsxPreview({
  attachment,
}: {
  attachment: SkillAttachmentView;
}) {
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const workbookQuery = useQuery({
    queryKey: [
      "skill-attachment-xlsx-preview",
      attachment.artifact.id,
      attachment.file?.path ?? "missing",
      attachment.file?.content.length ?? 0,
    ],
    queryFn: async () => {
      if (!attachment.file) {
        throw new Error("첨부 파일 본문이 없습니다.");
      }

      const bytes = decodedAttachmentBytes(attachment.file);
      return parseXlsxPreview(bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer);
    },
    enabled: Boolean(attachment.file),
  });
  const workbook = workbookQuery.data ?? null;
  const selectedSheet = workbook?.sheets[selectedSheetIndex] ?? workbook?.sheets[0] ?? null;

  useEffect(() => {
    if (!workbook || workbook.sheets[selectedSheetIndex]) {
      return;
    }
    setSelectedSheetIndex(0);
  }, [selectedSheetIndex, workbook]);

  if (workbookQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        엑셀 파일을 읽는 중입니다.
      </div>
    );
  }

  if (workbookQuery.isError || !workbook || !selectedSheet) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        엑셀 파일을 표로 읽지 못했습니다.
      </div>
    );
  }

  const sheets = workbook.sheets;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-3 py-2">
        {sheets.map((sheet, index) => (
          <button
            key={`${sheet.name}:${index}`}
            type="button"
            onClick={() => setSelectedSheetIndex(index)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
              selectedSheetIndex === index
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <SkillAttachmentSheetTable sheet={selectedSheet} />
      </div>
    </div>
  );
}

function SkillAttachmentPreview({
  attachment,
}: {
  attachment: SkillAttachmentView | null;
}) {
  const objectUrl = useAttachmentObjectUrl(attachment);

  if (!attachment) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        첨부 파일을 선택하면 내용을 확인할 수 있습니다.
      </div>
    );
  }

  if (!attachment.file) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        첨부 파일 메타데이터는 있지만 패키지 파일 본문을 찾지 못했습니다.
      </div>
    );
  }

  const type = baseContentType(attachment.artifact.contentType);
  if (isXlsxAttachment(attachment.artifact)) {
    return <SkillAttachmentXlsxPreview attachment={attachment} />;
  }

  if (objectUrl && type.startsWith("image/")) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/40 p-4">
        <img
          src={objectUrl}
          alt={attachment.artifact.fileName}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (objectUrl && type === "application/pdf") {
    return (
      <iframe
        title={`${attachment.artifact.fileName} 미리보기`}
        src={objectUrl}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  if (isTextLikeAttachment(attachment.artifact)) {
    return (
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words bg-background p-4 font-mono text-xs leading-6 text-foreground">
        {decodedAttachmentText(attachment.file)}
      </pre>
    );
  }

  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      이 파일 형식은 바로 미리보기보다 다운로드로 확인하는 파일입니다.
    </div>
  );
}

function SkillAttachmentSection({ skill }: { skill: MdTemplateDefinition }) {
  const artifacts = skill.inputArtifacts ?? [];
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const filesQuery = useQuery({
    queryKey: ["skill-template-files", skill.id],
    queryFn: () => agentEngineClient.getSkillTemplateFiles(skill.id),
    enabled: artifacts.length > 0 && Boolean(previewAttachmentId),
  });
  const attachments = useMemo(
    () => buildSkillAttachmentViews(skill, filesQuery.data ?? []),
    [filesQuery.data, skill]
  );
  const previewAttachment =
    attachments.find((attachment) => attachment.artifact.id === previewAttachmentId) ??
    null;
  const objectUrl = useAttachmentObjectUrl(previewAttachment);

  useEffect(() => {
    setPreviewAttachmentId(null);
  }, [skill.id]);

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2">
        <Paperclip className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">첨부 파일</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {artifacts.length}개
        </span>
      </div>

      {artifacts.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          이 스킬에 고정 첨부 파일은 없습니다.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {attachments.map((attachment) => (
            <button
              key={attachment.artifact.id}
              type="button"
              onClick={() => setPreviewAttachmentId(attachment.artifact.id)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-left transition hover:border-foreground/30 hover:bg-secondary/60"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {attachment.artifact.fileName}
                  </span>
                </span>
                <Eye className="mt-1 size-4 shrink-0 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(previewAttachmentId)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewAttachmentId(null);
          }
        }}
      >
        <DialogContent className="flex h-[min(88vh,56rem)] max-h-[88vh] w-[min(96vw,72rem)] max-w-[72rem] flex-col gap-0 overflow-hidden border-border bg-background p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                  <Eye className="size-3.5" />
                  Preview
                </div>
                <DialogTitle className="mt-2 truncate text-xl font-semibold text-foreground">
                  {previewAttachment?.artifact.fileName ?? "첨부 파일 미리보기"}
                </DialogTitle>
                <DialogDescription className="mt-1 break-all text-xs leading-6">
                  {previewAttachment?.artifact.skillPath ??
                    previewAttachment?.file?.path ??
                    "패키지 경로 없음"}
                </DialogDescription>
              </div>
              {previewAttachment?.file && objectUrl ? (
                <a
                  href={objectUrl}
                  download={previewAttachment.artifact.fileName}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <Download className="size-4" />
                  원본
                </a>
              ) : null}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {filesQuery.isLoading ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                첨부 파일을 불러오는 중입니다.
              </div>
            ) : filesQuery.isError ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                첨부 파일을 불러오지 못했습니다.
              </div>
            ) : (
              <SkillAttachmentPreview attachment={previewAttachment} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EditableTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commit();
  }

  if (editing) {
    return (
      <form onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="h-10 px-2 text-2xl font-semibold tracking-normal"
          aria-label="스킬 이름 수정"
        />
      </form>
    );
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={0}
      className="cursor-text rounded text-2xl font-semibold tracking-normal text-foreground hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
      title="클릭하여 이름 수정"
    >
      {value}
    </h1>
  );
}

function EditableDescription({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      });
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onSave(trimmed);
    }
    setEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="min-h-20 text-sm leading-6"
        aria-label="스킬 설명 수정"
      />
    );
  }

  return (
    <p
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={0}
      className={cn(
        "cursor-text rounded text-sm leading-6 hover:bg-muted/40 focus:bg-muted/40 focus:outline-none",
        value ? "text-muted-foreground" : "italic text-muted-foreground/60",
      )}
      title="클릭하여 설명 수정"
    >
      {value || "설명을 추가하려면 클릭하세요"}
    </p>
  );
}

function SkillNotFound() {
  return (
    <PageContainer>
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          스킬을 찾을 수 없습니다.
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          삭제되었거나 이 브라우저에 저장된 스킬이 아닙니다.
        </p>
      </div>
    </PageContainer>
  );
}
