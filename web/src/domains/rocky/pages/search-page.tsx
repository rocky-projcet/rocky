import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LayoutTemplate, ListTodo, Search as SearchIcon } from "lucide-react";

import { useRockyChatsQuery } from "@/domains/rocky/hooks";
import {
  formatRockyTaskDateTime,
  getRockyTaskRequest,
  getRockyTaskStatus,
  getRockyTaskSummary,
  getRockyTaskTemplateGroup,
  rockyTaskStatusLabel,
  rockyTaskStatusTone,
} from "@/domains/rocky/lib/rocky-task-model";
import { useMdTemplates } from "@/domains/template/hooks";
import type { MdTemplateDefinition } from "@/domains/template/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/utils";

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

export function SearchPage() {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalized(query);
  const { userTemplates } = useMdTemplates();
  const rockyChatsQuery = useRockyChatsQuery();
  const chats = rockyChatsQuery.data ?? [];
  const templateResults = useMemo(
    () =>
      userTemplates
        .filter((template) => templateMatches(template, normalizedQuery))
        .slice(0, 12),
    [normalizedQuery, userTemplates]
  );
  const taskResults = useMemo(
    () =>
      chats
        .filter((chat) => {
          if (!normalizedQuery) {
            return true;
          }

          const group = getRockyTaskTemplateGroup(chat, userTemplates);
          return [
            chat.title,
            group.label,
            getRockyTaskRequest(chat),
            getRockyTaskSummary(chat),
          ].some((value) => normalized(value).includes(normalizedQuery));
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 12),
    [chats, normalizedQuery, userTemplates]
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <SearchIcon className="size-4" />
          검색
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
          템플릿과 작업 찾기
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          자주 쓰는 템플릿을 바로 실행하거나 진행 중인 작업으로 빠르게 이동합니다.
        </p>
      </header>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
          placeholder="템플릿 이름, 작업 요약, 파일 기준으로 검색"
          className="h-11 pl-9"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <LayoutTemplate className="size-4" />
              템플릿
            </h2>
            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
              {templateResults.length}개
            </Badge>
          </div>

          <div className="grid gap-2">
            {templateResults.length > 0 ? (
              templateResults.map((template) => (
                <article key={template.id} className="rounded-lg border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Badge
                        variant="outline"
                        className="h-6 border-border bg-muted px-2 text-[11px] text-muted-foreground"
                      >
                        {template.triggerLabel}
                      </Badge>
                      <h3 className="mt-3 truncate text-sm font-semibold text-foreground">
                        {template.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {template.description}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      render={<Link to={`/?templateId=${encodeURIComponent(template.id)}`} />}
                    >
                      시작
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                일치하는 템플릿이 없습니다.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ListTodo className="size-4" />
              작업
            </h2>
            <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
              {taskResults.length}개
            </Badge>
          </div>

          <div className="grid gap-2">
            {rockyChatsQuery.isLoading ? (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                작업을 불러오는 중입니다.
              </div>
            ) : taskResults.length > 0 ? (
              taskResults.map((chat) => {
                const status = getRockyTaskStatus(chat);
                const group = getRockyTaskTemplateGroup(chat, userTemplates);

                return (
                  <article key={chat.id} className="rounded-lg border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-6 border px-2 text-[11px]",
                              rockyTaskStatusTone(status)
                            )}
                          >
                            {rockyTaskStatusLabel(status)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="h-6 border-border bg-muted px-2 text-[11px] text-muted-foreground"
                          >
                            {group.label}
                          </Badge>
                        </div>
                        <h3 className="mt-3 truncate text-sm font-semibold text-foreground">
                          {chat.title || getRockyTaskRequest(chat)}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {getRockyTaskSummary(chat)}
                        </p>
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          {formatRockyTaskDateTime(chat.updatedAt)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        render={<Link to={`/tasks/${encodeURIComponent(chat.id)}`} />}
                      >
                        열기
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
                일치하는 작업이 없습니다.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
