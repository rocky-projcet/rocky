import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowUpFromLine, Copy, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatRuntimeModelLabel } from "@/domains/codex/lib/runtime-model-options";
import {
  ollamaLaunchTargetLabel,
  runtimeLabel,
} from "@/domains/codex/lib/provider-display";
import {
  useAgentTasksQuery,
  useDeleteTaskMutation,
  useRunTaskMutation,
  useUpdateTaskMutation,
} from "@/domains/task/hooks";
import type { AgentTaskRecord } from "@/domains/task/types";
import { agentEngineClient } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { TaskEditorDialog } from "./task-editor-dialog";
import { TaskResultDialog } from "./task-result-dialog";

function formatDateTime(value: string | null): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function taskStatusTone(status: string | null): string {
  if (status === "running") {
    return "bg-amber-500/12 text-amber-700";
  }

  if (status === "failed") {
    return "bg-destructive/12 text-destructive";
  }

  if (status === "completed") {
    return "bg-emerald-500/12 text-emerald-700";
  }

  return "bg-secondary text-secondary-foreground";
}

function webhookUrl(task: AgentTaskRecord): string {
  return agentEngineClient.resolveApiPath(
    `/tasks/events/${encodeURIComponent(task.eventTrigger.webhookToken)}`
  );
}

export function AgentTaskSection({ agentId }: { agentId: string }) {
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AgentTaskRecord | null>(null);
  const [resultTask, setResultTask] = useState<AgentTaskRecord | null>(null);

  const tasksQuery = useAgentTasksQuery(agentId, {
    includeArchived: true,
  });
  const updateTaskMutation = useUpdateTaskMutation(agentId);
  const deleteTaskMutation = useDeleteTaskMutation(agentId);
  const runTaskMutation = useRunTaskMutation(agentId);
  const allTasks = tasksQuery.data ?? [];
  const visibleTasks = showArchivedTasks
    ? allTasks
    : allTasks.filter((task) => task.lifecycle !== "archived");
  const summary = useMemo(
    () => ({
      activeCount: allTasks.filter((task) => task.lifecycle !== "archived").length,
      scheduledCount: allTasks.filter(
        (task) => task.lifecycle !== "archived" && task.schedule.enabled
      ).length,
      eventCount: allTasks.filter(
        (task) => task.lifecycle !== "archived" && task.eventTrigger.enabled
      ).length,
    }),
    [allTasks]
  );
  const errorMessage =
    tasksQuery.error instanceof Error
      ? tasksQuery.error.message
      : updateTaskMutation.error instanceof Error
        ? updateTaskMutation.error.message
        : deleteTaskMutation.error instanceof Error
          ? deleteTaskMutation.error.message
          : runTaskMutation.error instanceof Error
            ? runTaskMutation.error.message
            : null;

  async function handleRunTask(task: AgentTaskRecord) {
    const taskRun = await runTaskMutation.mutateAsync(task.id);
    toast.success("단일 작업 실행을 시작했습니다.", {
      description: `${task.name} 실행이 시작되었습니다.`,
      action: taskRun.runId
        ? {
            label: "대화 상세",
            onClick: () => {
              window.location.href = `/runs/${taskRun.runId}`;
            },
          }
        : undefined,
    });
  }

  async function handleCopyWebhook(task: AgentTaskRecord) {
    try {
      await navigator.clipboard.writeText(webhookUrl(task));
      toast.success("Webhook URL을 복사했습니다.");
    } catch {
      toast.error("Webhook URL을 복사하지 못했습니다.");
    }
  }

  return (
    <>
      <Card className="flex h-full min-h-0 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">단일 작업</p>
            <h4 className="mt-2 text-lg font-semibold font-semibold text-foreground">
              저장된 재사용 작업
            </h4>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              하네스 세션에서 검증된 작업을 저장해두고, 수동 실행, 주기 실행, Webhook 이벤트
              트리거로 반복 재사용합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setShowArchivedTasks((current) => !current)}
            >
              {showArchivedTasks ? "보관 숨기기" : "보관 보기"}
            </Button>
            <Button
              onClick={() => {
                setEditingTask(null);
                setEditorOpen(true);
              }}
            >
              저장된 작업 만들기
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-muted/70 px-4 py-4">
            <p className="text-xs uppercase text-muted-foreground">활성 작업</p>
            <div className="mt-2 text-sm font-semibold font-semibold text-foreground">
              {summary.activeCount}
            </div>
          </div>
          <div className="rounded-2xl bg-muted/70 px-4 py-4">
            <p className="text-xs uppercase text-muted-foreground">주기 실행</p>
            <div className="mt-2 text-sm font-semibold font-semibold text-foreground">
              {summary.scheduledCount}
            </div>
          </div>
          <div className="rounded-2xl bg-muted/70 px-4 py-4">
            <p className="text-xs uppercase text-muted-foreground">이벤트 트리거</p>
            <div className="mt-2 text-sm font-semibold font-semibold text-foreground">
              {summary.eventCount}
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {tasksQuery.isLoading ? (
          <div className="rounded-3xl border border-border bg-muted px-5 py-8 text-sm text-muted-foreground">
            저장된 단일 작업을 불러오는 중입니다.
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-muted px-5 py-8 text-sm text-muted-foreground">
            저장된 단일 작업이 없습니다. 검증된 프롬프트를 작업으로 저장해 반복 실행할 수 있습니다.
          </div>
        ) : (
          <div className="min-h-0 flex-1 custom-scrollbar overflow-y-auto pr-1">
            <div className="space-y-3">
              {visibleTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-3xl border border-border/80 bg-card/70 px-5 py-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="min-w-0 truncate text-sm font-semibold font-semibold text-foreground">
                          {task.name}
                        </h5>
                        <Badge className="rounded-full bg-secondary text-secondary-foreground">
                          {runtimeLabel(task.runtimeKind)}
                        </Badge>
                        {task.runtimeKind === "ollama" ? (
                          <Badge className="rounded-full bg-muted text-muted-foreground">
                            {ollamaLaunchTargetLabel(task.ollamaLaunchTarget)}
                          </Badge>
                        ) : null}
                        <Badge className={taskStatusTone(task.lastRunStatus)}>
                          {task.lastRunStatus ?? "대기"}
                        </Badge>
                        {task.lifecycle === "archived" ? (
                          <Badge className="rounded-full bg-secondary text-secondary-foreground">
                            보관됨
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {task.description || "설명이 없습니다."}
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <Badge className="rounded-full bg-muted text-muted-foreground">
                          모델 {formatRuntimeModelLabel(task.model)}
                        </Badge>
                        <Badge className="rounded-full bg-muted text-muted-foreground">
                          수동 실행 가능
                        </Badge>
                        {task.schedule.enabled ? (
                          <Badge className="rounded-full bg-muted text-muted-foreground">
                            매 {task.schedule.intervalMinutes}분
                          </Badge>
                        ) : null}
                        {task.eventTrigger.enabled ? (
                          <Badge className="rounded-full bg-muted text-muted-foreground">
                            Webhook 이벤트
                          </Badge>
                        ) : null}
                        {task.messengerDelivery.enabled ? (
                          <Badge className="rounded-full bg-muted text-muted-foreground">
                            Telegram 전달
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-5">
                        <div>
                          <div className="uppercase">최근 실행</div>
                          <div className="mt-1 text-foreground">{formatDateTime(task.lastRunAt)}</div>
                        </div>
                        <div>
                          <div className="uppercase">주기 다음 실행</div>
                          <div className="mt-1 text-foreground">
                            {task.schedule.enabled
                              ? formatDateTime(task.schedule.nextRunAt)
                              : "비활성"}
                          </div>
                        </div>
                        <div>
                          <div className="uppercase">Webhook</div>
                          <div className="mt-1 text-foreground">
                            {task.eventTrigger.enabled ? "활성" : "비활성"}
                          </div>
                        </div>
                        <div>
                          <div className="uppercase">최근 요약</div>
                          <div className="mt-1 line-clamp-2 text-foreground">
                            {task.lastRunSummary ?? "아직 없음"}
                          </div>
                        </div>
                        <div>
                          <div className="uppercase">채널 전달</div>
                          <div className="mt-1 text-foreground">
                            {task.messengerDelivery.enabled
                              ? task.messengerDelivery.lastDeliveredAt
                                ? `전달됨 · ${formatDateTime(task.messengerDelivery.lastDeliveredAt)}`
                                : task.messengerDelivery.lastError
                                  ? `실패 · ${task.messengerDelivery.lastError}`
                                  : "대기"
                              : "사용 안 함"}
                          </div>
                        </div>
                      </div>

                      {task.eventTrigger.enabled ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <code className="rounded-full bg-muted px-3 py-1.5 text-muted-foreground">
                            {webhookUrl(task)}
                          </code>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleCopyWebhook(task)}
                          >
                            <Copy size={14} />
                            Webhook 복사
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        onClick={() => void handleRunTask(task)}
                        disabled={runTaskMutation.isPending || task.lifecycle === "archived"}
                      >
                        <Play size={14} />
                        수동 실행
                      </Button>
                      {task.lastSessionId ? (
                        <Button
                          variant="outline"
                          onClick={() => setResultTask(task)}
                        >
                          결과 보기
                        </Button>
                      ) : null}
                      {task.lastRunId ? (
                        <Link
                          to={`/runs/${task.lastRunId}`}
                          className={cn(buttonVariants({ variant: "outline" }))}
                        >
                            <ArrowUpFromLine size={14} />
                            최근 실행 보기
                        </Link>
                      ) : null}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditingTask(task);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil size={14} />
                        편집
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          void updateTaskMutation.mutateAsync({
                            taskId: task.id,
                            changes: {
                              lifecycle: task.lifecycle === "archived" ? "active" : "archived",
                            },
                          })
                        }
                      >
                        {task.lifecycle === "archived" ? (
                          <ArchiveRestore size={14} />
                        ) : (
                          <Archive size={14} />
                        )}
                        {task.lifecycle === "archived" ? "복구" : "보관"}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void deleteTaskMutation.mutateAsync(task.id)}
                        disabled={deleteTaskMutation.isPending}
                      >
                        <Trash2 size={14} />
                        삭제
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <TaskEditorDialog
        agentId={agentId}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        task={editingTask}
      />
      <TaskResultDialog
        open={Boolean(resultTask)}
        onOpenChange={(open) => {
          if (!open) {
            setResultTask(null);
          }
        }}
        task={resultTask}
      />
    </>
  );
}
