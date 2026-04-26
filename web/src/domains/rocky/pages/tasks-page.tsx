import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Clock3,
  FileInput,
  FileOutput,
  LayoutTemplate,
  ListTodo,
  Loader2,
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
  type RockyTaskTemplateGroup,
} from "@/domains/rocky/lib/rocky-task-model";
import type { RockyChatRecord } from "@/domains/rocky/types";
import { useMdTemplates } from "@/domains/template/hooks";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

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

function TaskCard({
  chat,
  templateGroup,
}: {
  chat: RockyChatRecord;
  templateGroup: RockyTaskTemplateGroup;
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

  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn("h-6 border px-2 text-[11px]", rockyTaskStatusTone(status))}
            >
              {rockyTaskStatusLabel(status)}
            </Badge>
            <Badge
              variant="outline"
              className="h-6 gap-1 border-border bg-muted px-2 text-[11px] text-muted-foreground"
            >
              <LayoutTemplate className="size-3" />
              {templateGroup.label}
            </Badge>
          </div>

          <h3 className="mt-3 truncate text-base font-semibold text-foreground">
            {chat.title || getRockyTaskRequest(chat)}
          </h3>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {getRockyTaskSummary(chat)}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
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
  );
}

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTemplateId = searchParams.get("template") ?? "all";
  const { userTemplates } = useMdTemplates();
  const rockyChatsQuery = useRockyChatsQuery();
  const chats = rockyChatsQuery.data ?? [];
  const sortedChats = useMemo(
    () => [...chats].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [chats]
  );
  const templateGroups = useMemo(() => {
    const groups = new Map<string, RockyTaskTemplateGroup>();
    userTemplates.forEach((template) => {
      groups.set(template.id, {
        id: template.id,
        label: template.title,
      });
    });
    sortedChats.forEach((chat) => {
      const group = getRockyTaskTemplateGroup(chat, userTemplates);
      groups.set(group.id, group);
    });
    return [...groups.values()];
  }, [sortedChats, userTemplates]);
  const visibleChats = useMemo(
    () =>
      selectedTemplateId === "all"
        ? sortedChats
        : sortedChats.filter(
            (chat) =>
              getRockyTaskTemplateGroup(chat, userTemplates).id === selectedTemplateId
          ),
    [selectedTemplateId, sortedChats, userTemplates]
  );
  const activeChats = sortedChats.filter(isRockyTaskActive);
  const completedCount = sortedChats.filter(
    (chat) => getRockyTaskStatus(chat) === "completed"
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ListTodo className="size-4" />
            작업
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
            Rocky 작업 목록
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Rocky가 진행 중이거나 완료한 작업을 상태, 템플릿, 입출력 파일 기준으로 확인합니다.
          </p>
        </div>
        <div className="grid min-w-72 grid-cols-3 gap-2">
          <div className="rounded-lg border bg-card px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">전체</div>
            <div className="mt-1 text-lg font-semibold">{sortedChats.length}</div>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">진행중</div>
            <div className="mt-1 text-lg font-semibold">{activeChats.length}</div>
          </div>
          <div className="rounded-lg border bg-card px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">완료</div>
            <div className="mt-1 text-lg font-semibold">{completedCount}</div>
          </div>
        </div>
      </header>

      <section className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={selectedTemplateId === "all" ? "default" : "outline"}
          onClick={() => setSearchParams({})}
        >
          전체
        </Button>
        {templateGroups.map((group) => (
          <Button
            key={group.id}
            type="button"
            size="sm"
            variant={selectedTemplateId === group.id ? "default" : "outline"}
            onClick={() => setSearchParams({ template: group.id })}
          >
            {group.label}
          </Button>
        ))}
      </section>

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
                className="rounded-md border bg-background px-3 py-2 text-sm transition hover:border-primary/40 hover:bg-secondary/50"
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
              templateGroup={getRockyTaskTemplateGroup(chat, userTemplates)}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
            <div className="text-sm font-medium text-foreground">표시할 작업이 없습니다.</div>
            <p className="mt-1 text-xs text-muted-foreground">
              홈에서 템플릿이나 요청을 실행하면 이곳에 작업으로 쌓입니다.
            </p>
            <Button className="mt-4" size="sm" render={<Link to="/" />}>
              홈에서 작업 시작
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
