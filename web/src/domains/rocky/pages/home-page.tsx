import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { FileText, Paperclip, Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { ArtifactPreviewCard } from "@/domains/run/components/artifact-preview-card";
import {
  useCreateRockyChatMutation,
  useRockyChatsQuery,
  useRockyChatQuery,
  useSendRockyMessageMutation,
} from "@/domains/rocky/hooks";
import type {
  AgentSessionArtifactManifestEntry,
  AgentSessionMessage,
} from "@/domains/session/types";
import { splitTranscriptArtifacts } from "@/domains/session/lib/transcript-display";
import { Button } from "@/shared/ui/button";
import { agentEngineClient } from "@/shared/lib/api-client";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";

import type {
  RockyAttachmentRecord,
  RockyChatRecord,
  RockyMessageRecord,
} from "@/domains/rocky/types";

const LIVE_TRANSCRIPT_REFRESH_INTERVAL_MS = 1500;

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
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

function findLatestAssistantMessage(
  transcript: AgentSessionMessage[] | undefined,
  runId: string | null
): AgentSessionMessage | null {
  if (!transcript || transcript.length === 0) {
    return null;
  }

  if (runId) {
    const runScoped = [...transcript]
      .reverse()
      .find((entry) => entry.role === "assistant" && entry.runId === runId);
    if (runScoped) {
      return runScoped;
    }
  }

  return (
    [...transcript].reverse().find((entry) => entry.role === "assistant") ?? null
  );
}

function resolveRockyMessageState(
  orchestration:
    | RockyChatRecord["dispatches"][number]["orchestration"]
    | null
    | undefined,
  message: RockyMessageRecord,
  transcriptMessage: AgentSessionMessage | null
):
  | { kind: "pending"; artifacts: AgentSessionArtifactManifestEntry[] }
  | { kind: "ready"; text: string; artifacts: AgentSessionArtifactManifestEntry[] }
  | { kind: "error"; text: string; artifacts: AgentSessionArtifactManifestEntry[] } {
  const artifacts = splitTranscriptArtifacts(transcriptMessage?.artifacts).visibleArtifacts;

  if (message.role !== "rocky") {
    return { kind: "ready", text: message.text, artifacts: [] };
  }

  if (!orchestration) {
    return { kind: "ready", text: message.text, artifacts };
  }

  if (orchestration.status === "planned" || orchestration.status === "running") {
    return { kind: "pending", artifacts };
  }

  if (orchestration.status === "failed") {
    return {
      kind: "error",
      text: orchestration.error?.trim() || "답변을 완료하지 못했어요.",
      artifacts,
    };
  }

  if (orchestration.status === "cancelled") {
    return {
      kind: "error",
      text: "답변 생성이 취소되었어요.",
      artifacts,
    };
  }

  const finalText =
    transcriptMessage?.content.trim() ||
    orchestration.output?.trim() ||
    message.text.trim();
  if (finalText) {
    return { kind: "ready", text: finalText, artifacts };
  }

  return {
    kind: "error",
    text: "최종 답변을 불러오지 못했어요.",
    artifacts,
  };
}

function RockyMarkdownViewer({ markdown }: { markdown: string }) {
  return (
    <div className="text-sm leading-7 text-foreground md:text-[15px]">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-5 text-lg font-semibold text-foreground first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mt-3 leading-7 text-foreground first:mt-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mt-3 list-disc space-y-2 pl-5 first:mt-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-3 list-decimal space-y-2 pl-5 first:mt-0">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mt-4 border-l-2 border-border pl-4 text-muted-foreground first:mt-0">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline decoration-border underline-offset-4"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-border" />,
          pre: ({ children }) => (
            <div className="custom-scrollbar mt-4 overflow-x-auto rounded-2xl border border-border bg-secondary/90 px-4 py-4 text-foreground first:mt-0">
              <pre className="w-fit min-w-full whitespace-pre font-mono text-xs leading-6 text-foreground">
                {children}
              </pre>
            </div>
          ),
          code: ({ className, children }) => {
            const content =
              typeof children === "string"
                ? children
                : Array.isArray(children)
                  ? children
                    .map((child) => (typeof child === "string" ? child : ""))
                    .join("")
                  : "";
            const isBlockCode =
              Boolean(className?.includes("language-")) || content.includes("\n");

            if (isBlockCode) {
              return <code className={className}>{children}</code>;
            }

            return (
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {children}
              </code>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function RockyArtifactGrid({
  artifacts,
}: {
  artifacts: AgentSessionArtifactManifestEntry[];
}) {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 grid gap-3">
      {artifacts.map((artifact) => (
        <ArtifactPreviewCard
          key={artifact.role}
          artifact={artifact}
          showInspectLink={false}
        />
      ))}
    </div>
  );
}

function RockyReplyMark() {
  return (
    <div className="mt-1 h-6 w-7 shrink-0 overflow-hidden rounded-lg bg-secondary/85">
      <img
        src="/Rocky_logo_mark.svg"
        alt=""
        aria-hidden="true"
        className="block h-full w-full object-contain"
      />
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
  transcriptsBySessionId,
}: {
  chat: RockyChatRecord;
  message: RockyMessageRecord;
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
}) {
  const isRocky = message.role === "rocky";
  const dispatch =
    chat.dispatches.find((entry) => entry.id === message.dispatchId) ?? null;
  const transcriptMessage = dispatch?.orchestration?.sessionId
    ? findLatestAssistantMessage(
        transcriptsBySessionId[dispatch.orchestration.sessionId],
        dispatch.orchestration.runId
      )
    : null;
  const rockyMessageState = resolveRockyMessageState(
    dispatch?.orchestration,
    message,
    transcriptMessage
  );
  const attachments = chat.attachments.filter((attachment) =>
    message.attachmentIds.includes(attachment.id)
  );

  if (isRocky && rockyMessageState.kind === "pending") {
    return (
      <div className="flex w-full items-start justify-start gap-2.5">
        <RockyReplyMark />
        <article
          className="w-full max-w-[52rem] px-1 pb-2 pt-0 text-sm leading-6 text-muted-foreground md:px-2"
          aria-live="polite"
          role="status"
        >
          <div className="inline-flex items-center gap-2">
            <span>답변중</span>
            <span className="ia-streaming-dots" aria-label="Rocky가 답변을 작성하고 있습니다">
              <span className="ia-streaming-dot" />
              <span className="ia-streaming-dot" />
              <span className="ia-streaming-dot" />
            </span>
          </div>
          <RockyArtifactGrid artifacts={rockyMessageState.artifacts} />
        </article>
      </div>
    );
  }

  const bubbleText =
    !isRocky || rockyMessageState.kind === "pending"
      ? message.text
      : rockyMessageState.text;
  const bubbleTone =
    isRocky && rockyMessageState.kind === "error"
      ? "text-destructive"
      : isRocky
        ? "text-foreground"
        : "text-primary-foreground";

  return (
    <div
      className={cn(
        "flex w-full",
        isRocky ? "items-start justify-start gap-2.5" : "justify-end"
      )}
    >
      {isRocky ? <RockyReplyMark /> : null}
      <article
        className={cn(
          "text-sm leading-6",
          isRocky
            ? cn(
                "w-full max-w-[52rem] px-1 pb-2 pt-0 md:px-2",
                bubbleTone
              )
            : cn("max-w-[min(44rem,86%)] rounded-lg bg-primary px-4 py-3 md:px-5", bubbleTone)
        )}
      >
        {isRocky ? (
          rockyMessageState.kind === "error" ? (
            <div className="whitespace-pre-wrap">{bubbleText}</div>
          ) : (
            <RockyMarkdownViewer markdown={bubbleText} />
          )
        ) : (
          <div className="whitespace-pre-wrap">{bubbleText}</div>
        )}
        <MessageAttachmentList attachments={attachments} isRocky={isRocky} />
        {isRocky ? <RockyArtifactGrid artifacts={rockyMessageState.artifacts} /> : null}
      </article>
    </div>
  );
}

function MessageList({
  chat,
  endRef,
  transcriptsBySessionId,
}: {
  chat: RockyChatRecord;
  endRef: RefObject<HTMLDivElement | null>;
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
}) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5 pb-8">
      {chat.messages.map((message) => (
        <MessageBubble
          key={message.id}
          chat={chat}
          message={message}
          transcriptsBySessionId={transcriptsBySessionId}
        />
      ))}
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
  const { data: rockyChats } = useRockyChatsQuery();
  const createChatMutation = useCreateRockyChatMutation();
  const sendMessageMutation = useSendRockyMessageMutation(chat?.id ?? null);
  const { data: refreshedChat, refetch: refetchRockyChat } = useRockyChatQuery(
    chat?.id ?? null
  );
  const transcriptSessionIds =
    chat?.dispatches.flatMap((dispatch) =>
      dispatch.orchestration?.sessionId ? [dispatch.orchestration.sessionId] : []
    ) ?? [];
  const uniqueTranscriptSessionIds = [...new Set(transcriptSessionIds)];
  const activeTranscriptSessionIds = new Set(
    chat?.dispatches.flatMap((dispatch) => {
      const orchestration = dispatch.orchestration;
      if (
        orchestration?.sessionId &&
        (orchestration.status === "running" || orchestration.status === "planned")
      ) {
        return [orchestration.sessionId];
      }

      return [];
    }) ?? []
  );
  const transcriptQueries = useQueries({
    queries: uniqueTranscriptSessionIds.map((sessionId) => ({
      queryKey: ["transcript", sessionId],
      queryFn: () => agentEngineClient.getTranscript(sessionId),
      enabled: Boolean(sessionId),
      refetchInterval: activeTranscriptSessionIds.has(sessionId)
        ? LIVE_TRANSCRIPT_REFRESH_INTERVAL_MS
        : false,
      refetchIntervalInBackground: activeTranscriptSessionIds.has(sessionId),
    })),
  });
  const transcriptsBySessionId: Record<string, AgentSessionMessage[]> = {};
  uniqueTranscriptSessionIds.forEach((sessionId, index) => {
    const transcript = transcriptQueries[index]?.data;
    if (transcript) {
      transcriptsBySessionId[sessionId] = transcript;
    }
  });
  const transcriptRefreshMarker = transcriptQueries
    .map((query) => String(query.dataUpdatedAt ?? 0))
    .join(":");

  const messageCount = chat?.messages.length ?? 0;
  const hasActiveOrchestration =
    chat?.dispatches.some((dispatch) => {
      const status = dispatch.orchestration?.status;
      return status === "running" || status === "planned";
    }) ?? false;
  const pending = createChatMutation.isPending || sendMessageMutation.isPending;
  const canSend = message.trim().length > 0 && !pending;
  const errorMessage =
    createChatMutation.error?.message ?? sendMessageMutation.error?.message;

  useEffect(() => {
    if (refreshedChat) {
      setChat(refreshedChat);
    }
  }, [refreshedChat]);

  useEffect(() => {
    if (chat || !rockyChats || rockyChats.length === 0) {
      return;
    }

    setChat(rockyChats[0]);
  }, [chat, rockyChats]);

  useEffect(() => {
    if (!chat?.id || !hasActiveOrchestration) {
      return;
    }

    const timer = window.setInterval(() => {
      void refetchRockyChat();
    }, 1500);

    return () => window.clearInterval(timer);
  }, [chat?.id, hasActiveOrchestration, refetchRockyChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messageCount, transcriptRefreshMarker]);

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
          <MessageList
            chat={chat}
            endRef={messagesEndRef}
            transcriptsBySessionId={transcriptsBySessionId}
          />
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
