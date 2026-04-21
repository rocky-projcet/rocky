import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import {
  ExternalLink,
  FileText,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  useCreateRockyChatMutation,
  useSendRockyMessageMutation,
} from "@/domains/rocky/hooks";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";

import type {
  RockyAttachmentRecord,
  RockyChatRecord,
  RockyMessageRecord,
  RockyOrchestrationRecord,
} from "@/domains/rocky/types";

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function orchestrationStatusLabel(orchestration: RockyOrchestrationRecord): string {
  switch (orchestration.status) {
    case "running":
      return "실행 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    case "cancelled":
      return "취소됨";
    case "planned":
    default:
      return "실행 대기";
  }
}

function orchestrationStatusVariant(
  orchestration: RockyOrchestrationRecord
): "secondary" | "outline" | "destructive" {
  if (orchestration.status === "failed" || orchestration.status === "cancelled") {
    return "destructive";
  }
  if (orchestration.status === "running" || orchestration.status === "completed") {
    return "secondary";
  }
  return "outline";
}

function MessageStatus({
  chat,
  message,
}: {
  chat: RockyChatRecord;
  message: RockyMessageRecord;
}) {
  if (message.role !== "rocky") {
    return null;
  }

  const candidates = chat.skillCandidates.filter((candidate) =>
    message.skillCandidateIds.includes(candidate.id)
  );
  const dispatch = chat.dispatches.find((entry) => entry.id === message.dispatchId);
  const protectionHintCount = dispatch?.protectionHints.length ?? 0;
  const orchestration = dispatch?.orchestration ?? null;
  const needsClarification = message.intent === "clarification";

  if (
    !message.workerId &&
    candidates.length === 0 &&
    protectionHintCount === 0 &&
    !orchestration &&
    !needsClarification
  ) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {message.workerId ? (
        <Badge variant="secondary">
          <Sparkles />
          {chat.worker?.displayName ?? "담당 준비됨"}
        </Badge>
      ) : null}
      {needsClarification ? <Badge variant="outline">확인 필요</Badge> : null}
      {orchestration ? (
        <Badge variant={orchestrationStatusVariant(orchestration)}>
          {orchestrationStatusLabel(orchestration)}
        </Badge>
      ) : null}
      {candidates.length > 0 ? (
        <Badge variant="outline">반복 기준 후보 {candidates.length}개</Badge>
      ) : null}
      {protectionHintCount > 0 ? (
        <Badge variant="destructive">
          <ShieldCheck />
          보호 항목 {protectionHintCount}개
        </Badge>
      ) : null}
      {orchestration?.agentId && orchestration.sessionId ? (
        <Button
          variant="outline"
          size="xs"
          render={
            <Link
              to={`/agents/${encodeURIComponent(orchestration.agentId!)}/sessions/${encodeURIComponent(
                orchestration.sessionId
              )}`}
            />
          }
        >
          세션 열기
          <ExternalLink />
        </Button>
      ) : null}
    </div>
  );
}

function CandidateList({ chat }: { chat: RockyChatRecord }) {
  if (chat.skillCandidates.length === 0) {
    return null;
  }

  return (
    <details className="rounded-lg border bg-background/80 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        반복해서 쓸 기준 후보
      </summary>
      <div className="mt-3 grid gap-2">
        {chat.skillCandidates.map((candidate) => (
          <div key={candidate.id} className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">{candidate.title}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {candidate.description}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function EmptyChatState() {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center pb-16 text-center">
      <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
        무엇을 도와드릴까요?
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">
        필요한 일을 편하게 말해 주세요.
      </p>
    </div>
  );
}

function MessageAttachmentList({
  attachments,
  isRocky,
}: {
  attachments: RockyAttachmentRecord[];
  isRocky: boolean;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
            isRocky ? "bg-muted" : "bg-background/15"
          )}
        >
          <FileText className="size-3" />
          {attachment.name}
        </span>
      ))}
    </div>
  );
}

function MessageBubble({
  chat,
  message,
}: {
  chat: RockyChatRecord;
  message: RockyMessageRecord;
}) {
  const isRocky = message.role === "rocky";
  const attachments = chat.attachments.filter((attachment) =>
    message.attachmentIds.includes(attachment.id)
  );

  return (
    <div className={cn("flex w-full", isRocky ? "justify-start" : "justify-end")}>
      <article
        className={cn(
          "max-w-[min(44rem,86%)] rounded-lg px-4 py-3 text-sm leading-6 md:px-5",
          isRocky
            ? "bg-transparent text-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        <div className="whitespace-pre-wrap">{message.text}</div>
        <MessageAttachmentList attachments={attachments} isRocky={isRocky} />
        <MessageStatus chat={chat} message={message} />
      </article>
    </div>
  );
}

function MessageList({
  chat,
  endRef,
}: {
  chat: RockyChatRecord;
  endRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5 pb-8">
      {chat.messages.map((message) => (
        <MessageBubble key={message.id} chat={chat} message={message} />
      ))}
      <CandidateList chat={chat} />
      <div ref={endRef} />
    </div>
  );
}

function SelectedFileList({
  files,
  onRemove,
}: {
  files: File[];
  onRemove: (file: File) => void;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 flex flex-wrap gap-2 px-1 pt-1">
      {files.map((file) => (
        <span
          key={`${file.name}-${file.size}`}
          className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs"
        >
          <FileText className="size-3 shrink-0" />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`${file.name} 제거`}
            onClick={() => onRemove(file)}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function ChatComposer({
  canSend,
  chatStarted,
  errorMessage,
  files,
  message,
  onFilesChange,
  onFileRemove,
  onMessageChange,
  onSubmit,
}: {
  canSend: boolean;
  chatStarted: boolean;
  errorMessage: string | undefined;
  files: File[];
  message: string;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (file: File) => void;
  onMessageChange: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <footer className="shrink-0 bg-background px-3 pb-4 pt-2 md:px-6 md:pb-6">
      <form
        className="mx-auto w-full max-w-4xl rounded-2xl border bg-card p-2 shadow-sm"
        onSubmit={onSubmit}
      >
        <SelectedFileList files={files} onRemove={onFileRemove} />

        <div className="flex min-h-12 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="자료 추가"
            className="shrink-0"
            render={<label />}
          >
            <Paperclip />
            <input
              type="file"
              multiple
              className="sr-only"
              aria-label="자료 파일 선택"
              onChange={(event) => {
                onFilesChange(Array.from(event.target.files ?? []));
              }}
            />
          </Button>
          <Textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder="자료를 넣고 원하는 일을 말해보세요."
            aria-label="Rocky에게 말하기"
            className="max-h-36 min-h-10 flex-1 border-0 bg-transparent px-2 py-2.5 text-sm leading-5 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label={chatStarted ? "보내기" : "시작하기"}
            className="shrink-0"
          >
            <Send />
          </Button>
        </div>

        {errorMessage ? (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}
      </form>
    </footer>
  );
}

export function HomePage() {
  const [chat, setChat] = useState<RockyChatRecord | null>(null);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const createChatMutation = useCreateRockyChatMutation();
  const sendMessageMutation = useSendRockyMessageMutation(chat?.id ?? null);

  const messageCount = chat?.messages.length ?? 0;
  const pending = createChatMutation.isPending || sendMessageMutation.isPending;
  const canSend = message.trim().length > 0 && !pending;
  const errorMessage =
    createChatMutation.error?.message ?? sendMessageMutation.error?.message;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) {
      return;
    }

    const input = {
      message: message.trim(),
      attachments: files.map((file) => ({
        name: file.name,
        contentType: file.type || null,
        size: file.size,
      })),
    };
    const nextChat = chat
      ? await sendMessageMutation.mutateAsync(input)
      : await createChatMutation.mutateAsync(input);

    setChat(nextChat);
    setMessage("");
    setFiles([]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-8">
        {chat && messageCount > 0 ? (
          <MessageList chat={chat} endRef={messagesEndRef} />
        ) : (
          <EmptyChatState />
        )}
      </main>

      <ChatComposer
        canSend={canSend}
        chatStarted={Boolean(chat)}
        errorMessage={errorMessage}
        files={files}
        message={message}
        onFilesChange={setFiles}
        onFileRemove={(file) =>
          setFiles((current) => current.filter((item) => item !== file))
        }
        onMessageChange={setMessage}
        onSubmit={submit}
      />
    </div>
  );
}
