import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Archive, ArchiveRestore, FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useQueryClient } from "@tanstack/react-query";

import {
  agentQueryKeys,
  useAgentQuery,
  useDeleteAgentMutation,
  useUpdateAgentMutation,
} from "../hooks";
import type { AgentRecord } from "../types";
import { SoulCard } from "../components/soul-card";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";
import { useAgentEmoji } from "../lib/agent-avatar-store";
import { AgentAvatar } from "../components/agent-avatar";
import { AgentEmojiPicker } from "../components/agent-emoji-picker";
import { AgentWorkspaceBrowserPanel } from "../components/agent-workspace-browser-panel";
import { agentEngineClient } from "@/shared/lib/api-client";

export function AgentDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agentId } = useParams<{ agentId: string }>();
  const agentQuery = useAgentQuery(agentId);
  const updateMutation = useUpdateAgentMutation(agentId);
  const deleteMutation = useDeleteAgentMutation();

  const agent = agentQuery.data ?? null;
  const { emoji, setEmoji } = useAgentEmoji(agentId);

  const [pendingDelete, setPendingDelete] = useState(false);
  const [workspaceOpenPending, setWorkspaceOpenPending] = useState(false);

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
      { agentId: agent.id },
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 pb-8 md:px-10 md:pb-10">
      <div className="sticky top-0 z-20 -mx-8 flex flex-col gap-6 bg-background px-8 pb-4 pt-8 md:-mx-10 md:px-10 md:pb-5 md:pt-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-4">
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
            <div className="min-w-0 flex-1">
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
              <div className="mt-2 w-full">
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
                <Button variant="outline" onClick={toggleArchive} disabled={updateMutation.isPending}>
                  <ArchiveRestore className="size-4" />
                  복원
                </Button>
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
              </>
            ) : (
              <Button variant="outline" onClick={toggleArchive} disabled={updateMutation.isPending}>
                <Archive className="size-4" />
                보관
              </Button>
            )}
          </div>
        </header>
      </div>

      <div className="flex flex-col gap-6">
        <SoulCard
          agentId={agent.id}
          agentName={agent.name}
          soul={agent.soul}
          readOnly={archived}
          onSaved={(nextSoul) => {
            queryClient.setQueryData<AgentRecord>(
              agentQueryKeys.agent(agent.id),
              (current) => (current ? { ...current, soul: nextSoul } : current),
            );
          }}
        />

        <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
          <AgentWorkspaceBrowserPanel
            agentId={agent.id}
            workspaceRoot={agent.workspaceRoot}
            title="작업 폴더"
          />
        </section>
      </div>

      {archived ? (
        <div className="sticky bottom-0 z-10 -mx-2 mt-2 rounded-2xl border border-dashed border-border/70 bg-background/95 p-4 text-center text-sm text-muted-foreground backdrop-blur supports-[backdrop-filter]:bg-background/80">
          보관된 에이전트는 작업을 받을 수 없어요. 다시 사용하려면 위에서 복원해주세요.
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title="에이전트를 영구 삭제할까요?"
        description={
          agent
            ? `"${agent.name}"을(를) 되돌릴 수 없게 삭제합니다.`
            : undefined
        }
        confirmLabel="삭제"
        destructive
        onConfirm={performDelete}
        pending={deleteMutation.isPending}
      />
    </div>
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
      <form onSubmit={handleSubmit} className="w-full">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className="h-11 w-full px-3 text-2xl font-semibold tracking-normal"
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
    if (trimmed !== value) {
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

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="h-10 w-full px-3 text-sm leading-6"
        placeholder="이 직원이 어떤 일을 하는지 한 줄로 적어주세요"
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
