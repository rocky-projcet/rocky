import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  FolderOpen,
  ListTodo,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  useAgentQuery,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from "../hooks";
import { useMdTemplates } from "@/domains/template/hooks";
import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";
import {
  formatRockyTaskDateTime,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskSummary,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import {
  useCreateRockyChatMutation,
  useDeleteRockyChatMutation,
  useRockyChatsQuery,
} from "@/domains/rocky/hooks";
import type { RockyChatRecord } from "@/domains/rocky/types";
import type { MdTemplateDefinition } from "@/domains/template/types";
import {
  countCompletedRockyTasksForAgent,
  listRockyChatsForAgent,
  type TaskAgentMap,
} from "../lib/agent-task-summary";
import {
  TaskComposer,
  composeFreeFormPrompt,
} from "@/domains/skill/components/task-composer";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { useAgentSkills } from "../lib/agent-skill-store";
import { useAgentEmoji } from "../lib/agent-avatar-store";
import { readAllTaskAgentMap, rememberTaskAgent } from "../lib/task-agent-store";
import { AgentAvatar } from "../components/agent-avatar";
import { AgentEmojiPicker } from "../components/agent-emoji-picker";
import type { AgentLocalSkillRecord } from "../types";
import { agentEngineClient } from "@/shared/lib/api-client";

type EquippedSkillItem = {
  record: AgentLocalSkillRecord;
  template: MdTemplateDefinition | null;
};

export function AgentDetailPage() {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  const initialPinnedSkillId = searchParams.get("skill");
  const agentQuery = useAgentQuery(agentId);
  const updateMutation = useUpdateAgentMutation(agentId);
  const createChatMutation = useCreateRockyChatMutation();
  const deleteMutation = useDeleteAgentMutation();
  const { skillIds, skillRecords, attachSkill, detachSkill, isMutating: skillMutating } =
    useAgentSkills(agentId);
  const { userTemplates } = useMdTemplates();
  const chatsQuery = useRockyChatsQuery();

  const agent = agentQuery.data ?? null;
  const { emoji, setEmoji } = useAgentEmoji(agentId);
  const chats = chatsQuery.data ?? [];
  const taskAgentMap = useMemo(() => readAllTaskAgentMap(), [chats]);
  const completedTaskCount = useMemo(
    () =>
      countCompletedRockyTasksForAgent(
        chats,
        agent?.id ?? agentId ?? "",
        taskAgentMap,
      ),
    [agent?.id, agentId, chats, taskAgentMap],
  );

  const equippedSkillItems = useMemo<EquippedSkillItem[]>(
    () =>
      skillRecords.map((record) => ({
        record,
        template:
          userTemplates.find((entry) => entry.skill.id === record.id) ??
          userTemplates.find((entry) => entry.id === record.id) ??
          null,
      })),
    [skillRecords, userTemplates],
  );
  const equippedTemplateSkills = useMemo(
    () =>
      equippedSkillItems
        .map((item) => item.template)
        .filter((entry): entry is MdTemplateDefinition => Boolean(entry)),
    [equippedSkillItems],
  );

  const availableSkills = useMemo(
    () => userTemplates.filter((entry) => !skillIds.includes(entry.skill.id)),
    [skillIds, userTemplates],
  );

  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingDetach, setPendingDetach] = useState<EquippedSkillItem | null>(null);
  const [pendingTaskDelete, setPendingTaskDelete] = useState<RockyChatRecord | null>(null);
  const [workspaceOpenPending, setWorkspaceOpenPending] = useState(false);
  const deleteChatMutation = useDeleteRockyChatMutation(null);

  function confirmTaskDelete() {
    if (!pendingTaskDelete) return;
    const target = pendingTaskDelete;
    deleteChatMutation.mutate(target.id, {
      onSuccess: () => {
        toast.success("작업을 삭제했습니다.", {
          description: target.title || undefined,
        });
        setPendingTaskDelete(null);
      },
      onError: (error) => {
        toast.error("작업 삭제에 실패했습니다.", {
          description: error instanceof Error ? error.message : undefined,
        });
      },
    });
  }

  if (agentQuery.isLoading) {
    return (
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
        <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-12 text-center text-sm text-muted-foreground">
          에이전트를 불러오는 중입니다.
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">
            에이전트를 찾을 수 없습니다.
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            삭제되었거나 이 계정에 없는 에이전트입니다.
          </p>
        </div>
      </div>
    );
  }

  function toggleArchive() {
    if (!agent) return;
    const next = agent.lifecycle === "archived" ? "active" : "archived";
    updateMutation.mutate(
      { lifecycle: next },
      {
        onSuccess: () => {
          toast.success(next === "archived" ? "에이전트를 보관했습니다." : "에이전트를 복원했습니다.");
          navigate(next === "archived" ? "/agents" : `/agents/${encodeURIComponent(agent!.id)}`, {
            replace: true,
          });
        },
      },
    );
  }

  function performDelete() {
    if (!agent) return;
    deleteMutation.mutate(
      { agentId: agent.id, stopRunningSessions: true },
      {
        onSuccess: () => {
          toast.success("에이전트를 삭제했습니다.");
          setPendingDelete(false);
          navigate("/agents/archived", { replace: true });
        },
        onError: (error) => {
          toast.error("삭제하지 못했습니다.", {
            description: error instanceof Error ? error.message : undefined,
          });
        },
      },
    );
  }

  function openWorkspaceFolder() {
    if (!agent || workspaceOpenPending) return;

    setWorkspaceOpenPending(true);
    agentEngineClient
      .openNativeFile(agentEngineClient.agentWorkspaceFolderNativeOpenPath(agent.id))
      .then(() => {
        toast.success("에이전트 작업 폴더를 열었습니다.");
      })
      .catch((error: unknown) => {
        toast.error("작업 폴더를 열지 못했습니다.", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => setWorkspaceOpenPending(false));
  }

  const archived = agent.lifecycle === "archived";


  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
      <div className="custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto pb-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            {archived ? (
              <AgentAvatar
                emoji={emoji}
                color={agent.color}
                size="xl"
                className="opacity-80"
              />
            ) : (
              <AgentEmojiPicker
                emoji={emoji}
                color={agent.color}
                onChangeEmoji={setEmoji}
                onChangeColor={(next) => updateMutation.mutate({ color: next })}
                trigger={
                  <button
                    type="button"
                    aria-label="캐릭터 변경"
                    className="group cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <AgentAvatar
                      emoji={emoji}
                      color={agent.color}
                      size="xl"
                      className="[&>span]:transition-transform group-hover:[&>span]:scale-110"
                    />
                  </button>
                }
              />
            )}
            <div className="min-w-0">
              {archived ? (
                <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                  {agent.name}
                </h1>
              ) : (
                <EditableTitle
                  value={agent.name}
                  onSave={(next) => updateMutation.mutate({ name: next })}
                />
              )}
              <div className="mt-2 max-w-2xl">
                {archived ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {agent.description || "설명이 없어요."}
                  </p>
                ) : (
                  <EditableDescription
                    value={agent.description}
                    onSave={(next) =>
                      updateMutation.mutate({ description: next || null })
                    }
                  />
                )}
              </div>
              {archived ? (
                <span className="mt-3 inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  보관됨
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={openWorkspaceFolder}
              disabled={workspaceOpenPending}
              title="실제 폴더 열기"
            >
              <FolderOpen className="size-4" />
              폴더 열기
            </Button>
            {archived ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPendingDelete(true)}
                  disabled={deleteMutation.isPending}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  aria-label="에이전트 영구 삭제"
                  title="에이전트 영구 삭제"
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button variant="outline" onClick={toggleArchive} disabled={updateMutation.isPending}>
                  <ArchiveRestore className="size-4" />
                  복원
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={toggleArchive} disabled={updateMutation.isPending}>
                <Archive className="size-4" />
                보관
              </Button>
            )}
          </div>
        </header>

        <CharacterStats
          skillCount={skillRecords.length}
          taskCount={completedTaskCount}
        />

        <section>
          <header className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="size-4 text-muted-foreground" />
                장착된 스킬
                <span className="text-xs font-normal text-muted-foreground">
                  {skillRecords.length}개
                </span>
              </h2>
              {archived ? null : (
                <p className="mt-1 text-xs text-muted-foreground">
                  아래 채팅창에 자연어로 일을 요청하면 이 에이전트가 알맞은 스킬을 골라 발사해요.
                </p>
              )}
            </div>
            {!archived && availableSkills.length > 0 ? (
              <Button
                size="sm"
                onClick={() => setSkillPickerOpen((current) => !current)}
              >
                <Plus className="size-4" />
                스킬 추가
              </Button>
            ) : null}
          </header>

          {archived ? null : (
            <SkillPickerDialog
              open={skillPickerOpen}
              onOpenChange={setSkillPickerOpen}
              available={availableSkills}
              pending={skillMutating}
              onAttach={async (skill) => {
                try {
                  await attachSkill(skill);
                  toast.success("스킬을 장착했습니다.");
                } catch (error) {
                  toast.error("스킬을 장착하지 못했습니다.", {
                    description: error instanceof Error ? error.message : undefined,
                  });
                }
              }}
            />
          )}

          {equippedSkillItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
              {archived
                ? "장착된 스킬이 없는 채로 보관되었어요."
                : "아직 장착된 스킬이 없어요. 위에서 스킬을 골라 장착해보세요."}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {equippedSkillItems.map((item) => (
                <li key={item.record.id}>
                  <EquippedSkillCard
                    item={item}
                    fromAgentId={agent.id}
                    readOnly={archived}
                    onDetach={() => setPendingDetach(item)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListTodo className="size-4 text-muted-foreground" />
            이 에이전트가 한 작업
          </h2>
          <AgentTaskList
            agentId={agent.id}
            chats={chats}
            taskAgentMap={taskAgentMap}
            loading={chatsQuery.isLoading}
            onDelete={(chat) => setPendingTaskDelete(chat)}
          />
        </section>
      </div>

      {archived ? (
        <div className="shrink-0 rounded-2xl border border-dashed border-border/70 bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          보관된 에이전트는 작업을 받을 수 없어요. 다시 사용하려면 위에서 복원해주세요.
        </div>
      ) : (
        <TaskComposer
          recipientName={agent.name}
          equippedSkills={equippedTemplateSkills}
          pending={createChatMutation.isPending}
          initialPinnedSkillId={initialPinnedSkillId}
          onSubmit={async ({ message, files, skill }) => {
            const fileNames = files.map((file) => file.name);
            const composedMessage = composeFreeFormPrompt(
              message || (skill ? `${skill.title}로 진행해줘.` : ""),
              fileNames,
            );
            try {
              const chat = await createChatMutation.mutateAsync({
                message: composedMessage,
                agentId: agent.id,
                skillId: skill?.skill.id ?? null,
              });
              rememberTaskAgent(chat.id, agent.id);
              toast.success(`${agent.name}이(가) 작업을 시작했어요.`);
              navigate(`/tasks/${encodeURIComponent(chat.id)}`);
            } catch (error) {
              toast.error("작업을 시작하지 못했습니다.", {
                description: error instanceof Error ? error.message : undefined,
              });
            }
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title="에이전트를 영구 삭제할까요?"
        description={
          agent
            ? `"${agent.name}"을(를) 되돌릴 수 없게 삭제합니다. 작업 이력도 함께 정리돼요.`
            : undefined
        }
        confirmLabel="삭제"
        destructive
        onConfirm={performDelete}
        pending={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(pendingTaskDelete)}
        onOpenChange={(next) => {
          if (!next) setPendingTaskDelete(null);
        }}
        title="작업을 삭제할까요?"
        description={
          pendingTaskDelete
            ? `"${pendingTaskDelete.title || "제목 없음"}" 작업과 대화 기록을 되돌릴 수 없게 삭제합니다.`
            : undefined
        }
        confirmLabel="삭제"
        destructive
        pending={deleteChatMutation.isPending}
        onConfirm={confirmTaskDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingDetach)}
        onOpenChange={(next) => {
          if (!next) setPendingDetach(null);
        }}
        title="스킬을 해제할까요?"
        description={
          pendingDetach
            ? `"${pendingDetach.template?.title ?? pendingDetach.record.displayName}"을(를) 이 에이전트에서 제거합니다. 저장된 템플릿은 유지됩니다.`
            : undefined
        }
        confirmLabel="해제"
        pending={skillMutating}
        onConfirm={async () => {
          if (!pendingDetach) return;
          try {
            await detachSkill(pendingDetach.record.id);
            toast.success("스킬을 해제했습니다.");
            setPendingDetach(null);
          } catch (error) {
            toast.error("스킬을 해제하지 못했습니다.", {
              description: error instanceof Error ? error.message : undefined,
            });
          }
        }}
      />
    </div>
  );
}

function CharacterStats({
  skillCount,
  taskCount,
}: {
  skillCount: number;
  taskCount: number;
}) {
  const level = Math.max(1, Math.floor(taskCount / 5) + 1);
  return (
    <div className="grid grid-cols-3 gap-3 rounded-2xl border border-border/70 bg-muted/30 p-4">
      <Stat label="장착 스킬" value={`${skillCount}개`} />
      <Stat label="완료 작업" value={`${taskCount}회`} />
      <Stat label="레벨" value={`Lv.${level}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function EquippedSkillCard({
  item,
  fromAgentId,
  onDetach,
  readOnly = false,
}: {
  item: EquippedSkillItem;
  fromAgentId: string;
  onDetach: () => void;
  readOnly?: boolean;
}) {
  const skill = item.template;
  const theme = skillKindTheme(skill ?? { category: "document", triggerLabel: "리서치" });
  const Icon = theme.Icon;
  const title = skill?.title ?? item.record.displayName;
  const description =
    skill?.description ??
    item.record.description ??
    "이 에이전트 workspace와 runtime home에 설치된 agent-local skill입니다.";
  const triggerLabel = skill?.triggerLabel ?? item.record.invocation;
  const skillHref = skill
    ? `/skills/${encodeURIComponent(skill.id)}?from=agent:${encodeURIComponent(fromAgentId)}`
    : null;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <div className={cn("flex size-10 items-center justify-center rounded-xl", theme.icon)}>
          <Icon className="size-5" />
        </div>
        <span
          className={cn(
            "ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
            theme.chip,
          )}
        >
          {triggerLabel}
        </span>
      </div>

      <div className="mt-3 min-w-0 flex-1">
        {skillHref ? (
          <Link
            to={skillHref}
            className="block min-w-0 no-underline"
          >
            <h3 className="truncate text-sm font-semibold text-foreground hover:underline">
              {title}
            </h3>
          </Link>
        ) : (
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
        )}
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>

      {readOnly ? null : (
        <div className="mt-3 flex justify-end">
          <Button
            variant="outline"
            size="xs"
            onClick={onDetach}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
            삭제
          </Button>
        </div>
      )}
    </div>
  );
}

function SkillPickerDialog({
  open,
  onOpenChange,
  available,
  onAttach,
  pending,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  available: MdTemplateDefinition[];
  onAttach: (skill: MdTemplateDefinition) => void | Promise<void>;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-3xl !min-w-[36rem]">
        <DialogHeader className="mb-6">
          <DialogTitle>스킬 추가</DialogTitle>
          <DialogDescription>
            이 에이전트에게 장착할 스킬을 선택하세요. 카드를 누르면 바로 장착됩니다.
          </DialogDescription>
        </DialogHeader>

        {available.length === 0 ? (
          <div className="flex h-[28rem] items-center justify-center rounded-xl border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
            장착 가능한 스킬이 없어요. 새 스킬을 만들어 추가해보세요.
          </div>
        ) : (
          <ul className="custom-scrollbar grid max-h-[28rem] min-h-[28rem] auto-rows-[7.5rem] content-start gap-3 overflow-y-auto sm:grid-cols-2">
            {available.map((skill) => {
              const theme = skillKindTheme(skill);
              const Icon = theme.Icon;
              return (
                <li key={skill.id} className="h-full">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={async () => {
                      await onAttach(skill);
                      onOpenChange(false);
                    }}
                    className="flex h-full w-full items-start gap-3 overflow-hidden rounded-xl border border-border/70 bg-background p-4 text-left transition hover:border-foreground/40 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", theme.icon)}>
                      <Icon className="size-5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span
                        className={cn(
                          "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          theme.chip,
                        )}
                      >
                        {skill.triggerLabel}
                      </span>
                      <p className="truncate text-sm font-medium text-foreground">{skill.title}</p>
                      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {skill.description}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AgentTaskList({
  agentId,
  chats,
  taskAgentMap,
  loading,
  onDelete,
}: {
  agentId: string;
  chats: Parameters<typeof listRockyChatsForAgent>[0];
  taskAgentMap: TaskAgentMap;
  loading: boolean;
  onDelete: (chat: RockyChatRecord) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
        작업을 불러오는 중입니다.
      </div>
    );
  }

  const items = listRockyChatsForAgent(chats, agentId, taskAgentMap)
    .map((chat) => ({
      chat,
      id: chat.id,
      title: chat.title || getRockyTaskRequest(chat) || "제목 없음",
      summary: getRockyTaskSummary(chat),
      status: getRockyTaskStatus(chat),
      updatedAt: chat.updatedAt,
      href: `/tasks/${encodeURIComponent(chat.id)}?from=agent:${encodeURIComponent(agentId)}`,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
        아직 이 에이전트가 한 작업이 없어요. 아래 채팅에 일을 부탁해보세요.
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={item.href}
            className="flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  rockyTaskStatusTone(item.status),
                )}
              >
                {rockyTaskStatusLabel(item.status)}
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
            <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-foreground">
              {item.title}
            </h3>
            {item.summary ? (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {item.summary}
              </p>
            ) : null}
            <div className="mt-3 text-[11px] text-muted-foreground">
              {formatRockyTaskDateTime(item.updatedAt)}
            </div>
            <div className="mt-3 flex flex-1 items-end justify-end">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete(item.chat);
                }}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 />
                삭제
              </Button>
            </div>
          </Link>
        </li>
      ))}
    </ul>
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
          aria-label="에이전트 이름 수정"
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
        aria-label="에이전트 설명 수정"
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
