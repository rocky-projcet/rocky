import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
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
import { useAgentSessionsQuery } from "@/domains/session/hooks";
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
import { useCreateRockyChatMutation, useRockyChatsQuery } from "@/domains/rocky/hooks";
import type { MdTemplateDefinition } from "@/domains/template/types";
import {
  TaskComposer,
  composeFreeFormPrompt,
  composeSkillRunPrompt,
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

export function AgentDetailPage() {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>();
  const agentQuery = useAgentQuery(agentId);
  const updateMutation = useUpdateAgentMutation(agentId);
  const createChatMutation = useCreateRockyChatMutation();
  const deleteMutation = useDeleteAgentMutation();
  const { skillIds, attachSkill, detachSkill } = useAgentSkills(agentId);
  const { userTemplates } = useMdTemplates();
  const sessionsQuery = useAgentSessionsQuery(agentId, { includeArchived: true });
  const chatsQuery = useRockyChatsQuery();

  const agent = agentQuery.data ?? null;
  const { emoji, setEmoji } = useAgentEmoji(agentId);

  const equippedSkills = useMemo(
    () =>
      skillIds
        .map((id) => userTemplates.find((entry) => entry.id === id) ?? null)
        .filter((entry): entry is MdTemplateDefinition => Boolean(entry)),
    [skillIds, userTemplates],
  );

  const availableSkills = useMemo(
    () => userTemplates.filter((entry) => !skillIds.includes(entry.id)),
    [skillIds, userTemplates],
  );

  const taskCount = (chatsQuery.data ?? []).length + (sessionsQuery.data ?? []).length;
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingDetach, setPendingDetach] = useState<MdTemplateDefinition | null>(null);

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
        <Button
          className="-ml-2 self-start"
          variant="ghost"
          size="sm"
          render={<Link to="/agents" />}
        >
          <ArrowLeft className="size-4" />
          내 에이전트
        </Button>
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

  const archived = agent.lifecycle === "archived";


  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
      <div className="custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto pb-6">
        <Button
          className="-ml-2 self-start"
          variant="ghost"
          size="sm"
          render={<Link to={archived ? "/agents/archived" : "/agents"} />}
        >
          <ArrowLeft className="size-4" />
          {archived ? "내 에이전트 보관함" : "내 에이전트"}
        </Button>

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
          skillCount={equippedSkills.length}
          taskCount={taskCount}
        />

        <section>
          <header className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="size-4 text-muted-foreground" />
                장착된 스킬
                <span className="text-xs font-normal text-muted-foreground">
                  {equippedSkills.length}개
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
                variant="outline"
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
              onAttach={(skillId) => {
                attachSkill(skillId);
                toast.success("스킬을 장착했습니다.");
              }}
            />
          )}

          {equippedSkills.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
              {archived
                ? "장착된 스킬이 없는 채로 보관되었어요."
                : "아직 장착된 스킬이 없어요. 위에서 스킬을 골라 장착해보세요."}
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {equippedSkills.map((skill) => (
                <li key={skill.id}>
                  <EquippedSkillCard
                    skill={skill}
                    readOnly={archived}
                    onDetach={() => setPendingDetach(skill)}
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
          <AgentTaskList agentId={agent.id} />
        </section>
      </div>

      {archived ? (
        <div className="shrink-0 rounded-2xl border border-dashed border-border/70 bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          보관된 에이전트는 작업을 받을 수 없어요. 다시 사용하려면 위에서 복원해주세요.
        </div>
      ) : (
        <TaskComposer
          recipientName={agent.name}
          equippedSkills={equippedSkills}
          pending={createChatMutation.isPending}
          onSubmit={async ({ message, files, skill }) => {
            const fileNames = files.map((file) => file.name);
            const composedMessage = skill
              ? composeSkillRunPrompt(skill, message, fileNames)
              : composeFreeFormPrompt(message, fileNames);
            try {
              const chat = await createChatMutation.mutateAsync({
                message: composedMessage,
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
        open={Boolean(pendingDetach)}
        onOpenChange={(next) => {
          if (!next) setPendingDetach(null);
        }}
        title="스킬을 해제할까요?"
        description={
          pendingDetach
            ? `"${pendingDetach.title}"을(를) 이 에이전트에서 제거합니다. 스킬 자체는 사라지지 않아요.`
            : undefined
        }
        confirmLabel="해제"
        onConfirm={() => {
          if (!pendingDetach) return;
          detachSkill(pendingDetach.id);
          toast.success("스킬을 해제했습니다.");
          setPendingDetach(null);
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
  skill,
  onDetach,
  readOnly = false,
}: {
  skill: MdTemplateDefinition;
  onDetach: () => void;
  readOnly?: boolean;
}) {
  const theme = skillKindTheme(skill);
  const Icon = theme.Icon;

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
          {skill.triggerLabel}
        </span>
      </div>

      <div className="mt-3 min-w-0 flex-1">
        <Link
          to={`/skills/${encodeURIComponent(skill.id)}`}
          className="block min-w-0 no-underline"
        >
          <h3 className="truncate text-sm font-semibold text-foreground hover:underline">
            {skill.title}
          </h3>
        </Link>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {skill.description}
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
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  available: MdTemplateDefinition[];
  onAttach: (skillId: string) => void;
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
          <ul className="custom-scrollbar grid max-h-[28rem] min-h-[28rem] auto-rows-min content-start gap-3 overflow-y-auto sm:grid-cols-2">
            {available.map((skill) => {
              const theme = skillKindTheme(skill);
              const Icon = theme.Icon;
              return (
                <li key={skill.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAttach(skill.id);
                      onOpenChange(false);
                    }}
                    className="flex w-full items-start gap-3 rounded-xl border border-border/70 bg-background p-4 text-left transition hover:border-foreground/40 hover:bg-muted/40"
                  >
                    <div className={cn("flex size-10 items-center justify-center rounded-xl", theme.icon)}>
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          theme.chip,
                        )}
                      >
                        {skill.triggerLabel}
                      </span>
                      <p className="mt-1 truncate text-sm font-medium text-foreground">{skill.title}</p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
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

function AgentTaskList({ agentId }: { agentId: string }) {
  const chatsQuery = useRockyChatsQuery();
  const chats = chatsQuery.data ?? [];
  const taskAgentMap = useMemo(() => readAllTaskAgentMap(), [chats]);

  if (chatsQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
        작업을 불러오는 중입니다.
      </div>
    );
  }

  const items = chats
    .filter((chat) => taskAgentMap[chat.id] === agentId)
    .map((chat) => ({
      id: chat.id,
      title: chat.title || getRockyTaskRequest(chat) || "제목 없음",
      summary: getRockyTaskSummary(chat),
      status: getRockyTaskStatus(chat),
      updatedAt: chat.updatedAt,
      href: `/tasks/${encodeURIComponent(chat.id)}`,
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
            className="block h-full rounded-2xl border border-border/70 bg-card p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-md"
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
