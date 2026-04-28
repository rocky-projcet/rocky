import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Archive, Bot, ListTodo } from "lucide-react";
import { toast } from "sonner";

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
import { PageContainer } from "@/shared/components/page-container";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";

export function SkillDetailPage() {
  const navigate = useNavigate();
  const { skillId } = useParams<{ skillId: string }>();
  const { userTemplates, archiveTemplate, updateTemplate } = useMdTemplates();
  const skill = useMemo(
    () => userTemplates.find((entry) => entry.id === skillId) ?? null,
    [skillId, userTemplates],
  );

  const chatsQuery = useRockyChatsQuery();

  const tasks = useMemo(() => {
    if (!skill) return [];
    const all = chatsQuery.data ?? [];
    return all
      .filter((chat) => {
        const group = getRockyTaskTemplateGroup(chat, userTemplates);
        return group.id === skill.id;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [chatsQuery.data, skill, userTemplates]);

  if (!skill) {
    return <SkillNotFound />;
  }

  function handleArchive() {
    if (!skill) return;
    archiveTemplate(skill.id);
    toast.success("스킬을 보관함으로 옮겼습니다.");
    navigate("/skills", { replace: true });
  }

  return (
    <PageContainer>
      <Button
        className="-ml-2 self-start"
        variant="ghost"
        size="sm"
        render={<Link to="/skills" />}
      >
        <ArrowLeft className="size-4" />
        스킬 목록
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Badge
            variant="outline"
            className="h-6 max-w-full border-border bg-muted px-2 text-[11px] text-muted-foreground"
          >
            {skill.triggerLabel}
          </Badge>
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

      <SkillSummary skill={skill} />

      <section className="rounded-2xl border border-dashed border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>
            스킬은 <Link to="/agents" className="font-medium text-foreground underline-offset-2 hover:underline">내 에이전트</Link>가 발사할 능력입니다. 작업을 시작하려면 이 스킬을 장착한 에이전트로 가서 발사해주세요.
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListTodo className="size-4 text-muted-foreground" />
          이 스킬로 한 작업
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {tasks.length}개
          </span>
        </h2>

        {chatsQuery.isLoading ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            작업을 불러오는 중입니다.
          </div>
        ) : tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            아직 이 스킬로 한 작업이 없습니다.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tasks.map((chat) => {
              const status = getRockyTaskStatus(chat);
              const summary = getRockyTaskSummary(chat);
              const request = getRockyTaskRequest(chat);
              return (
                <li key={chat.id}>
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
            })}
          </ul>
        )}
      </section>
    </PageContainer>
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
      <Button
        className="-ml-2 self-start"
        variant="ghost"
        size="sm"
        render={<Link to="/skills" />}
      >
        <ArrowLeft className="size-4" />
        스킬 목록
      </Button>
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
