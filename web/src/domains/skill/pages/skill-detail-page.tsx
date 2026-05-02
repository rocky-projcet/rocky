import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Archive,
  Bot,
  Download,
  Eye,
  FileText,
  ListTodo,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";

import { skillKindTheme } from "@/domains/skill/lib/skill-kind-theme";
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
import type {
  MdTemplateDefinition,
  MdTemplateInputArtifact,
} from "@/domains/template/types";
import { PageContainer } from "@/shared/components/page-container";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { agentEngineClient } from "@/shared/lib/api-client";
import type { AgentLocalSkillFileInput } from "@/shared/lib/agent-engine-client";
import {
  parseXlsxPreview,
  type XlsxPreviewSheet,
} from "@/shared/lib/xlsx-preview";
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
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl",
              theme.icon,
            )}
          >
            <Bot className="size-4" />
          </div>
          <p>
            스킬은{" "}
            <Link
              to="/agents"
              className="font-semibold underline underline-offset-2"
            >
              내 에이전트
            </Link>
            가 발사할 능력입니다. 작업을 시작하려면 이 스킬을 장착한 에이전트로 가서 발사해주세요.
          </p>
        </div>
      </section>

      <SkillSummary skill={skill} />

      <SkillAttachmentSection skill={skill} />

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

type SkillAttachmentView = {
  artifact: MdTemplateInputArtifact;
  file: AgentLocalSkillFileInput | null;
};

function formatFileSize(size: number | null | undefined): string {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return "크기 정보 없음";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [selectedId, setSelectedId] = useState<string | null>(
    artifacts[0]?.id ?? null
  );
  const filesQuery = useQuery({
    queryKey: ["skill-template-files", skill.id],
    queryFn: () => agentEngineClient.getSkillTemplateFiles(skill.id),
    enabled: artifacts.length > 0,
  });
  const attachments = useMemo(
    () => buildSkillAttachmentViews(skill, filesQuery.data ?? []),
    [filesQuery.data, skill]
  );
  const selectedAttachment =
    attachments.find((attachment) => attachment.artifact.id === selectedId) ??
    attachments[0] ??
    null;
  const objectUrl = useAttachmentObjectUrl(selectedAttachment);

  useEffect(() => {
    setSelectedId((current) =>
      current && attachments.some((attachment) => attachment.artifact.id === current)
        ? current
        : attachments[0]?.artifact.id ?? null
    );
  }, [attachments]);

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
        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <button
                key={attachment.artifact.id}
                type="button"
                onClick={() => setSelectedId(attachment.artifact.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition",
                  selectedAttachment?.artifact.id === attachment.artifact.id
                    ? "border-primary/45 bg-primary/5 shadow-sm"
                    : "border-border bg-background hover:bg-secondary/60"
                )}
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {attachment.artifact.fileName}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {attachment.artifact.skillPath ?? attachment.file?.path ?? "패키지 경로 없음"}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <span className="rounded-md bg-muted px-1.5 py-0.5">
                        {attachment.artifact.contentType ?? "application/octet-stream"}
                      </span>
                      <span>{formatFileSize(attachment.artifact.size)}</span>
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="flex h-[32rem] max-h-[70vh] min-w-0 flex-col overflow-hidden rounded-lg border bg-background">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                  <Eye className="size-3.5" />
                  Preview
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-foreground">
                  {selectedAttachment?.artifact.fileName ?? "파일 미리보기"}
                </div>
              </div>
              {selectedAttachment?.file && objectUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="첨부 파일 다운로드"
                  title="첨부 파일 다운로드"
                  render={
                    <a
                      href={objectUrl}
                      download={selectedAttachment.artifact.fileName}
                    />
                  }
                >
                  <Download className="size-4" />
                </Button>
              ) : null}
            </div>
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
                <SkillAttachmentPreview attachment={selectedAttachment} />
              )}
            </div>
          </div>
        </div>
      )}
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
