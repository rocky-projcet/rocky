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
import remarkGfm from "remark-gfm";

import { ArtifactPreviewCard } from "@/domains/run/components/artifact-preview-card";
import { PptxArtifactPreview } from "@/domains/run/components/pptx-artifact-preview";
import {
  useCreateRockyChatMutation,
  useDeleteRockyChatMutation,
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
import { WorkspaceAwareMarkdownLink } from "@/shared/components/workspace-aware-markdown-link";
import { agentEngineClient } from "@/shared/lib/api-client";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";

import type {
  RockyAttachmentRecord,
  RockyChatRecord,
  RockyMessageRecord,
} from "@/domains/rocky/types";

const LIVE_TRANSCRIPT_REFRESH_INTERVAL_MS = 1500;
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type RockyPreviewPanelSource = {
  contentType: string;
  detail: string;
  downloadHref: string;
  kind: "html" | "powerpoint";
  name: string;
};

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`;
  }

  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function openPopupLocation(popup: Window | null, href: string): void {
  if (popup) {
    popup.location.replace(href);
    return;
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

function baseContentType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isHtmlArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  return baseContentType(artifact.contentType) === "text/html";
}

function isPowerPointFile(name: string, contentType: string): boolean {
  const normalizedType = baseContentType(contentType);
  const normalizedName = name.toLowerCase();

  return normalizedType === PPTX_CONTENT_TYPE || normalizedName.endsWith(".pptx");
}

function isPowerPointArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  return isPowerPointFile(artifact.name, artifact.contentType);
}

function buildArtifactPreviewPanelSource(
  artifact: AgentSessionArtifactManifestEntry
): RockyPreviewPanelSource | null {
  const downloadHref = agentEngineClient.resolveApiPath(artifact.downloadUrl);

  if (isHtmlArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail: `${artifact.role} · ${artifact.contentType}`,
      downloadHref,
      kind: "html",
      name: artifact.name,
    };
  }

  if (isPowerPointArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail: `${artifact.role} · ${artifact.contentType}`,
      downloadHref,
      kind: "powerpoint",
      name: artifact.name,
    };
  }

  return null;
}

function markdownLinkEscape(value: string): string {
  return value.replace(/([\\\]])/g, "\\$1");
}

function markdownUrlEscape(value: string): string {
  return value.replace(/[()\\]/g, (match) => `\\${match}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function artifactLinkHref(artifact: AgentSessionArtifactManifestEntry): string {
  return `#rocky-artifact-${encodeURIComponent(artifact.role)}`;
}

function linkArtifactMentions(
  markdown: string,
  artifacts: AgentSessionArtifactManifestEntry[]
): string {
  const namedArtifacts = artifacts
    .filter((artifact) => artifact.name.trim())
    .sort((left, right) => right.name.length - left.name.length);

  if (namedArtifacts.length === 0) {
    return markdown;
  }

  const artifactPattern = new RegExp(
    `(^|[^\\w./-])(${namedArtifacts.map((artifact) => escapeRegExp(artifact.name)).join("|")})(?=$|[^\\w./-])`,
    "g"
  );
  let inFence = false;

  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }

      if (inFence || line.includes("](")) {
        return line;
      }

      return line.replace(artifactPattern, (match, prefix: string, name: string) => {
        const artifact = namedArtifacts.find((entry) => entry.name === name);
        if (!artifact) {
          return match;
        }

        return `${prefix}[${markdownLinkEscape(name)}](${markdownUrlEscape(
          artifactLinkHref(artifact)
        )})`;
      });
    })
    .join("\n");
}

function normalizeInlineMarkdownTables(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      if (!/\|\s*:?-{3,}/.test(line)) {
        return line;
      }

      const firstTablePipe = line.indexOf("|");
      const prefix = firstTablePipe > 0 ? line.slice(0, firstTablePipe).trimEnd() : "";
      const tableLine = firstTablePipe > 0 ? line.slice(firstTablePipe) : line;
      const normalizedTable = tableLine.replace(/\|\s+\|/g, "|\n|");

      return prefix ? `${prefix}\n\n${normalizedTable}` : normalizedTable;
    })
    .join("\n");
}

function openRockyArtifact(
  artifact: AgentSessionArtifactManifestEntry,
  onOpenPreviewPanel?: (source: RockyPreviewPanelSource) => void
): void {
  const previewPanelSource = buildArtifactPreviewPanelSource(artifact);

  if (previewPanelSource) {
    if (onOpenPreviewPanel) {
      onOpenPreviewPanel(previewPanelSource);
      return;
    }

    window.open(
      agentEngineClient.resolveApiPath(artifact.downloadUrl),
      "_blank",
      "noopener,noreferrer"
    );
    return;
  }

  const target = artifact.previewUrl ?? artifact.downloadUrl;
  window.open(agentEngineClient.resolveApiPath(target), "_blank", "noopener,noreferrer");
}

async function openRockyWorkspacePath(
  agentId: string,
  path: string,
  pathKind: "file" | "directory" | "ambiguous",
  onOpenPreviewPanel?: (source: RockyPreviewPanelSource) => void
): Promise<void> {
  if (pathKind === "directory") {
    return;
  }

  const normalizedPath = path.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalizedPath) {
    return;
  }

  const popup = window.open("", "_blank");

  try {
    const preview = await agentEngineClient.getAgentWorkspaceFilePreview(
      agentId,
      normalizedPath
    );
    const previewPanelKind =
      preview.previewKind === "html"
        ? "html"
        : isPowerPointFile(preview.name, preview.contentType)
          ? "powerpoint"
          : null;

    if (previewPanelKind && onOpenPreviewPanel) {
      popup?.close();
      onOpenPreviewPanel({
        contentType: preview.contentType,
        detail: `${preview.path} · ${preview.contentType}`,
        downloadHref: agentEngineClient.resolveApiPath(preview.downloadUrl),
        kind: previewPanelKind,
        name: preview.name,
      });
      return;
    }

    if (preview.inlinePreviewUrl) {
      openPopupLocation(
        popup,
        agentEngineClient.resolveApiPath(preview.inlinePreviewUrl)
      );
      return;
    }

    if (preview.previewKind === "html" && preview.text && !preview.truncated) {
      openPopupLocation(
        popup,
        `data:${preview.contentType};base64,${encodeUtf8Base64(preview.text)}`
      );
      return;
    }

    openPopupLocation(
      popup,
      agentEngineClient.resolveApiPath(preview.downloadUrl)
    );
  } catch {
    popup?.close();
  }
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
  | { kind: "pending"; text: string | null; artifacts: AgentSessionArtifactManifestEntry[] }
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
    const progressText =
      transcriptMessage?.content.trim() || orchestration.output?.trim() || null;
    return { kind: "pending", text: progressText, artifacts };
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

function RockyMarkdownViewer({
  agentId,
  artifacts,
  markdown,
  onOpenPreviewPanel,
  workspaceRoot,
}: {
  agentId: string | null;
  artifacts: AgentSessionArtifactManifestEntry[];
  markdown: string;
  onOpenPreviewPanel: (source: RockyPreviewPanelSource) => void;
  workspaceRoot: string | null;
}) {
  const artifactByRole = new Map(artifacts.map((artifact) => [artifact.role, artifact]));
  const linkedMarkdown = normalizeInlineMarkdownTables(
    linkArtifactMentions(markdown, artifacts)
  );

  return (
    <div className="text-sm leading-7 text-foreground md:text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          a: ({ children, href }) =>
            href?.startsWith("#rocky-artifact-") ? (
              <button
                type="button"
                onClick={() => {
                  const artifact = artifactByRole.get(
                    decodeURIComponent(href.slice("#rocky-artifact-".length))
                  );
                  if (artifact) {
                    openRockyArtifact(artifact, onOpenPreviewPanel);
                  }
                }}
                className="inline border-0 bg-transparent p-0 font-medium text-foreground underline decoration-border underline-offset-4"
              >
                {children}
              </button>
            ) : agentId && workspaceRoot ? (
              <WorkspaceAwareMarkdownLink
                href={href}
                workspaceRoot={workspaceRoot}
                onOpenWorkspacePath={(path, pathKind) => {
                  void openRockyWorkspacePath(
                    agentId,
                    path,
                    pathKind,
                    onOpenPreviewPanel
                  );
                }}
                className="inline border-0 bg-transparent p-0 font-medium text-foreground underline decoration-border underline-offset-4"
              >
                {children}
              </WorkspaceAwareMarkdownLink>
            ) : /^([A-Za-z][A-Za-z0-9+.-]*:)?\/\//.test(href?.trim() ?? "") ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline decoration-border underline-offset-4"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="custom-scrollbar mt-4 overflow-x-auto rounded-2xl border border-border bg-card first:mt-0">
              <table className="min-w-full border-collapse text-left text-sm leading-6">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-secondary/80 text-foreground">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border bg-background">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="divide-x divide-border align-top">{children}</tr>
          ),
          th: ({ children, style }) => (
            <th
              className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"
              style={style}
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td className="px-3 py-2 text-foreground" style={style}>
              {children}
            </td>
          ),
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
        {linkedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function RockyArtifactGrid({
  artifacts,
  onOpenPreviewPanel,
}: {
  artifacts: AgentSessionArtifactManifestEntry[];
  onOpenPreviewPanel: (source: RockyPreviewPanelSource) => void;
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
          onPreview={
            buildArtifactPreviewPanelSource(artifact)
              ? () => {
                  const source = buildArtifactPreviewPanelSource(artifact);
                  if (source) {
                    onOpenPreviewPanel(source);
                  }
                  return true;
                }
              : undefined
          }
          showInspectLink={false}
        />
      ))}
    </div>
  );
}

function RockyReplyMark() {
  return (
    <div className="rocky-reply-mark mt-1 h-6 w-7 shrink-0 rounded-lg bg-secondary/85">
      <img
        src="/Rocky_logo_mark.svg"
        alt=""
        aria-hidden="true"
        className="rocky-reply-mark__icon"
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
  agentWorkspaceRootsByAgentId,
  chat,
  message,
  onOpenPreviewPanel,
  transcriptsBySessionId,
}: {
  agentWorkspaceRootsByAgentId: Record<string, string>;
  chat: RockyChatRecord;
  message: RockyMessageRecord;
  onOpenPreviewPanel: (source: RockyPreviewPanelSource) => void;
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
}) {
  const isRocky = message.role === "rocky";
  const dispatch =
    chat.dispatches.find((entry) => entry.id === message.dispatchId) ?? null;
  const agentId = dispatch?.orchestration?.agentId ?? null;
  const workspaceRoot = agentId ? agentWorkspaceRootsByAgentId[agentId] ?? null : null;
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
          {rockyMessageState.text ? (
            <div className="mt-3 rounded-2xl border bg-background/70 px-4 py-3 text-foreground shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                최근 진행 내용
              </p>
              <RockyMarkdownViewer
                agentId={agentId}
                artifacts={rockyMessageState.artifacts}
                markdown={rockyMessageState.text}
                onOpenPreviewPanel={onOpenPreviewPanel}
                workspaceRoot={workspaceRoot}
              />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              작업 로그가 들어오면 이 영역에 바로 표시합니다.
            </p>
          )}
          <RockyArtifactGrid
            artifacts={rockyMessageState.artifacts}
            onOpenPreviewPanel={onOpenPreviewPanel}
          />
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
            <RockyMarkdownViewer
              agentId={agentId}
              artifacts={rockyMessageState.artifacts}
              markdown={bubbleText}
              onOpenPreviewPanel={onOpenPreviewPanel}
              workspaceRoot={workspaceRoot}
            />
          )
        ) : (
          <div className="whitespace-pre-wrap">{bubbleText}</div>
        )}
        <MessageAttachmentList attachments={attachments} isRocky={isRocky} />
        {isRocky ? (
          <RockyArtifactGrid
            artifacts={rockyMessageState.artifacts}
            onOpenPreviewPanel={onOpenPreviewPanel}
          />
        ) : null}
      </article>
    </div>
  );
}

function MessageList({
  agentWorkspaceRootsByAgentId,
  chat,
  endRef,
  onOpenPreviewPanel,
  transcriptsBySessionId,
}: {
  agentWorkspaceRootsByAgentId: Record<string, string>;
  chat: RockyChatRecord;
  endRef: RefObject<HTMLDivElement | null>;
  onOpenPreviewPanel: (source: RockyPreviewPanelSource) => void;
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
}) {
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5 pb-8">
      {chat.messages.map((message) => (
        <MessageBubble
          agentWorkspaceRootsByAgentId={agentWorkspaceRootsByAgentId}
          key={message.id}
          chat={chat}
          message={message}
          onOpenPreviewPanel={onOpenPreviewPanel}
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
  canClearChat,
  chatStarted,
  isClearingChat,
  errorMessage,
  files,
  message,
  onFilesChange,
  onFileRemove,
  onClearChat,
  onMessageChange,
  onSubmit,
}: {
  canSend: boolean;
  canClearChat: boolean;
  chatStarted: boolean;
  isClearingChat: boolean;
  errorMessage: string | undefined;
  files: File[];
  message: string;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (file: File) => void;
  onClearChat: () => void;
  onMessageChange: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <footer className="shrink-0 bg-background px-3 pb-4 pt-2 md:px-6 md:pb-6">
      {chatStarted ? (
        <div className="mx-auto mb-2 flex w-full max-w-4xl justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canClearChat}
            onClick={onClearChat}
          >
            {isClearingChat ? "정리중" : "대화 정리"}
          </Button>
        </div>
      ) : null}

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
            nativeButton={false}
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

function ArtifactPreviewPanel({
  onClose,
  source,
}: {
  onClose: () => void;
  source: RockyPreviewPanelSource;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; html: string }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    if (source.kind !== "html") {
      return;
    }

    const controller = new AbortController();

    setState({ kind: "loading" });
    fetch(source.downloadHref, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }

        setState({ kind: "ready", html: await response.text() });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "HTML 미리보기를 불러오지 못했습니다.",
        });
      });

    return () => controller.abort();
  }, [source.downloadHref, source.kind]);

  const panelLabel = source.kind === "powerpoint" ? "PPT 뷰어" : "HTML 리포트";
  const closeLabel =
    source.kind === "powerpoint" ? "PPT 뷰어 닫기" : "HTML 리포트 닫기";

  return (
    <aside className="flex h-[42vh] min-h-0 shrink-0 flex-col border-t border-border bg-card shadow-sm lg:h-auto lg:w-[min(42vw,44rem)] lg:border-l lg:border-t-0">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-label-md font-semibold uppercase text-muted-foreground">
            {panelLabel}
          </div>
          <div className="mt-1 truncate text-body-md font-semibold text-foreground">
            {source.name}
          </div>
          <div className="mt-0.5 truncate text-label-md text-muted-foreground">
            {source.detail}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={source.downloadHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full border border-border bg-background px-3 py-1.5 text-body-sm font-medium text-foreground no-underline transition hover:bg-secondary"
          >
            다운로드
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 bg-white">
        {source.kind === "powerpoint" ? (
          <div className="h-full bg-muted/40 p-4">
            <PptxArtifactPreview
              contentType={source.contentType}
              downloadHref={source.downloadHref}
              name={source.name}
            />
          </div>
        ) : state.kind === "loading" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-body-md text-muted-foreground">
            HTML 미리보기를 불러오는 중입니다.
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-body-md text-muted-foreground">
            HTML 미리보기를 불러오지 못했습니다. {state.message}
          </div>
        ) : (
          <iframe
            title={`${source.name} HTML 미리보기`}
            srcDoc={state.html}
            sandbox=""
            className="h-full w-full border-0"
          />
        )}
      </div>
    </aside>
  );
}

export function HomePage() {
  const [chat, setChat] = useState<RockyChatRecord | null>(null);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const [previewPanelSource, setPreviewPanelSource] =
    useState<RockyPreviewPanelSource | null>(null);
  const [suppressAutoSelect, setSuppressAutoSelect] = useState(false);
  const submitInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const { data: rockyChats } = useRockyChatsQuery();
  const createChatMutation = useCreateRockyChatMutation();
  const deleteChatMutation = useDeleteRockyChatMutation(chat?.id ?? null);
  const sendMessageMutation = useSendRockyMessageMutation(chat?.id ?? null);
  const { data: refreshedChat, refetch: refetchRockyChat } = useRockyChatQuery(
    chat?.id ?? null
  );
  const transcriptSessionIds =
    chat?.dispatches.flatMap((dispatch) =>
      dispatch.orchestration?.sessionId ? [dispatch.orchestration.sessionId] : []
    ) ?? [];
  const transcriptAgentIds =
    chat?.dispatches.flatMap((dispatch) =>
      dispatch.orchestration?.agentId ? [dispatch.orchestration.agentId] : []
    ) ?? [];
  const uniqueTranscriptSessionIds = [...new Set(transcriptSessionIds)];
  const uniqueTranscriptAgentIds = [...new Set(transcriptAgentIds)];
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
  const agentQueries = useQueries({
    queries: uniqueTranscriptAgentIds.map((agentId) => ({
      queryKey: ["agent", agentId],
      queryFn: () => agentEngineClient.getAgent(agentId),
      enabled: Boolean(agentId),
      staleTime: 60_000,
    })),
  });
  const transcriptsBySessionId: Record<string, AgentSessionMessage[]> = {};
  const agentWorkspaceRootsByAgentId: Record<string, string> = {};
  uniqueTranscriptSessionIds.forEach((sessionId, index) => {
    const transcript = transcriptQueries[index]?.data;
    if (transcript) {
      transcriptsBySessionId[sessionId] = transcript;
    }
  });
  uniqueTranscriptAgentIds.forEach((agentId, index) => {
    const agent = agentQueries[index]?.data;
    if (agent?.workspaceRoot) {
      agentWorkspaceRootsByAgentId[agentId] = agent.workspaceRoot;
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
  const pending =
    submitInFlight ||
    createChatMutation.isPending ||
    sendMessageMutation.isPending ||
    deleteChatMutation.isPending;
  const canSend = message.trim().length > 0 && !pending;
  const canClearChat = Boolean(chat && messageCount > 0) && !pending;
  const errorMessage =
    createChatMutation.error?.message ??
    sendMessageMutation.error?.message ??
    deleteChatMutation.error?.message;

  useEffect(() => {
    if (refreshedChat) {
      setChat(refreshedChat);
    }
  }, [refreshedChat]);

  useEffect(() => {
    if (chat || suppressAutoSelect || !rockyChats || rockyChats.length === 0) {
      return;
    }

    setChat(rockyChats[0]);
  }, [chat, rockyChats, suppressAutoSelect]);

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
    if (!canSend || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitInFlight(true);
    try {
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
    } finally {
      submitInFlightRef.current = false;
      setSubmitInFlight(false);
    }
  };

  const clearConversation = async () => {
    if (!chat?.id || !canClearChat) {
      return;
    }

    await deleteChatMutation.mutateAsync();
    setSuppressAutoSelect(true);
    setChat(null);
    setMessage("");
    setFiles([]);
    setPreviewPanelSource(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-8">
          {chat && messageCount > 0 ? (
            <MessageList
              agentWorkspaceRootsByAgentId={agentWorkspaceRootsByAgentId}
              chat={chat}
              endRef={messagesEndRef}
              onOpenPreviewPanel={setPreviewPanelSource}
              transcriptsBySessionId={transcriptsBySessionId}
            />
          ) : (
            <EmptyChatState />
          )}
        </main>

        <ChatComposer
          canSend={canSend}
          canClearChat={canClearChat}
          chatStarted={Boolean(chat)}
          isClearingChat={deleteChatMutation.isPending}
          errorMessage={errorMessage}
          files={files}
          message={message}
          onFilesChange={setFiles}
          onFileRemove={(file) =>
            setFiles((current) => current.filter((item) => item !== file))
          }
          onClearChat={() => {
            void clearConversation();
          }}
          onMessageChange={setMessage}
          onSubmit={submit}
        />
      </section>

      {previewPanelSource ? (
        <ArtifactPreviewPanel
          source={previewPanelSource}
          onClose={() => setPreviewPanelSource(null)}
        />
      ) : null}
    </div>
  );
}
