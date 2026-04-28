import {
  Children,
  cloneElement,
  type KeyboardEvent,
  isValidElement,
  type ReactNode,
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { AgentWorkspaceBrowserPanel } from "@/domains/agent/components/agent-workspace-browser-panel";
import { useAgentWorkspaceDirectoryQuery } from "@/domains/agent/hooks";
import { ArtifactPreviewCard } from "@/domains/run/components/artifact-preview-card";
import { ProviderGlyph } from "@/domains/codex/components/provider-glyph";
import { useRuntimesQuery } from "@/domains/codex/hooks";
import {
  ollamaLaunchTargetLabel,
  runtimeShortLabel,
} from "@/domains/codex/lib/provider-display";
import {
  DEFAULT_SERVICE_TIER_SELECTION,
  reasoningEffortLabel,
  resolveModelSelection,
  resolveModelReasoningEffort,
  resolveModelServiceTier,
  serviceTierLabel,
} from "@/domains/codex/lib/runtime-model-options";
import { PageState } from "@/shared/components/page-state";
import { WorkspaceAwareMarkdownLink } from "@/shared/components/workspace-aware-markdown-link";
import type {
  AgentRunRecord,
  RuntimeEvent,
  RuntimeRunResult,
} from "@/domains/run/types";
import type {
  AgentSessionArtifactManifestEntry,
  AgentSessionMessage,
  AgentSessionMessageBlock,
} from "@/domains/session/types";
import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  RuntimeDescriptorRecord,
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
} from "@/shared/lib/agent-engine-client";
import {
  useSendMessageMutation,
  useSessionQuery,
  useTranscriptQuery,
  useUpdateSessionMutation,
} from "../hooks";
import {
  useCancelRunMutation,
  agentEngineQueryKeys,
} from "@/domains/run/hooks";
import { RunEventsSource } from "@/domains/run/lib/run-events-source";
import {
  buildTranscriptDisplayEntries,
  formatElapsedDuration,
  isSuppressedTranscriptArtifact,
  normalizeStreamingMarkdown,
  splitTranscriptArtifacts,
  splitTextWithWorkspacePaths,
  type AssistantTranscriptSection,
  type WorkspacePathKind,
} from "../lib/transcript-display";
import {
  fileIdentity,
  mergeUniqueFiles,
} from "../lib/attachment-files";
import {
  readSessionRuntimeSelection,
  writeSessionRuntimeSelection,
} from "../lib/session-runtime-selection";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { CompactFileAttachmentPicker } from "@/domains/session/components/compact-file-attachment-picker";
import { TaskEditorDialog } from "@/domains/task/components/task-editor-dialog";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Textarea } from "@/shared/ui/textarea";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";
import {
  extractWorkspaceRelativeArtifactPath,
  inferWorkspacePathKind,
} from "@/shared/lib/workspace-link-target";
import { Folder, File, Share2, Square, Send, Check, X, Pencil, ArrowUpFromLine, Archive, PanelRightOpen, PanelRightClose, BookOpen, LockKeyhole, RotateCcw, ChevronDown, MessageCircleMore } from "lucide-react";

type LiveRunStatus = "idle" | "sending" | "streaming" | "completed" | "failed" | "cancelled";
const MAX_COMPOSER_HEIGHT_PX = 220;
const ACTIVE_RUN_POLL_INTERVAL_MS = 3000;
type PendingMessage = {
  id: string;
  runId?: string | null;
  role: "user" | "assistant";
  content: string;
  source: string;
};

const BUILT_IN_HARNESS_SKILLS = [
  {
    name: "openai-docs",
    description: "OpenAI 제품/API 관련 최신 공식 문서 기반 안내",
  },
  {
    name: "skill-creator",
    description: "새 스킬 작성과 기존 스킬 개선 가이드",
  },
  {
    name: "skill-installer",
    description: "큐레이션 목록 또는 GitHub 저장소에서 스킬 설치",
  },
] as const;

function statusTone(status: LiveRunStatus): string {
  if (status === "completed") {
    return "bg-secondary text-secondary-foreground";
  }

  if (status === "failed") {
    return "bg-destructive/15 text-destructive";
  }

  if (status === "cancelled") {
    return "bg-secondary text-secondary-foreground";
  }

  if (status === "streaming" || status === "sending") {
    return "bg-secondary text-secondary-foreground";
  }

  return "bg-secondary text-muted-foreground";
}

function mapRuntimeStatus(status: string | null | undefined): LiveRunStatus {
  if (status === "failed") {
    return "failed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "completed") {
    return "completed";
  }

  return "streaming";
}

function sessionLifecycleTone(lifecycle: string): string {
  return lifecycle === "archived"
    ? "bg-secondary text-secondary-foreground"
    : "bg-secondary text-secondary-foreground";
}

function sessionActionButtonTone(tone: "neutral" | "archive" | "restore"): string {
  if (tone === "archive") {
    return "bg-secondary text-secondary-foreground hover:bg-muted";
  }

  if (tone === "restore") {
    return "bg-secondary text-secondary-foreground hover:bg-secondary";
  }

  return "bg-secondary text-muted-foreground hover:bg-muted";
}

const SESSION_ICON_BUTTON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/60";

const SESSION_META_PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground";
const CHAT_MESSAGE_META_ROW_CLASS =
  "flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-normal leading-none";
const CHAT_MESSAGE_META_BADGE_CLASS =
  "rounded-full px-2 py-1 text-[11px] font-semibold leading-none";
const CHAT_MESSAGE_ROLE_LABEL_CLASS = "text-[11px] font-semibold leading-none";

function inspectorLinkTone(role: "assistant" | "user" | "system"): string {
  return role !== "user"
    ? "border-border/70 bg-card/75 text-foreground hover:bg-card"
    : "border-accent-foreground/25 bg-accent-foreground/10 text-accent-foreground hover:bg-accent-foreground/15";
}

function inspectorIconTone(role: "assistant" | "user" | "system"): string {
  return role !== "user"
    ? "text-muted-foreground hover:bg-muted hover:text-foreground"
    : "text-accent-foreground/75 hover:bg-accent-foreground/10 hover:text-accent-foreground";
}

function messageRoleLabel(role: "assistant" | "user" | "system"): string {
  if (role === "assistant") {
    return "어시스턴트";
  }

  if (role === "user") {
    return "사용자";
  }

  return "시스템";
}

function RunInspectorIconLink(props: {
  runId: string;
  role: "assistant" | "user" | "system";
}) {
  return (
    <Link
      to={`/runs/${props.runId}`}
      aria-label="대화 상세 보기"
      title="대화 상세 보기"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-full leading-none no-underline transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
        inspectorIconTone(props.role),
        "visited:text-inherit"
      )}
    >
      <MessageCircleMore size={14} />
    </Link>
  );
}

function eventString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

function isRunStreamable(run: AgentRunRecord | null): boolean {
  return run?.status === "running";
}

function isTerminalRunStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function parseFallbackBlocks(content: string): AgentSessionMessageBlock[] {
  const pattern = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  const blocks: AgentSessionMessageBlock[] = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      blocks.push({
        type: "text",
        text: content.slice(cursor, index),
      });
    }

    blocks.push({
      type: "code",
      language: match[1] ?? null,
      code: match[2] ?? "",
    });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    blocks.push({
      type: "text",
      text: content.slice(cursor),
    });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: content }];
}

function hasCodeBlocks(content: string): boolean {
  return /```[\s\S]*?```/.test(content);
}

function PlainMessageViewer(props: {
  message: AgentSessionMessage | PendingMessage;
  role: "user" | "assistant" | "system";
}) {
  const blocks =
    "blocks" in props.message && Array.isArray(props.message.blocks)
      ? props.message.blocks
      : parseFallbackBlocks(props.message.content);
  const artifacts =
    "artifacts" in props.message && Array.isArray(props.message.artifacts)
      ? props.message.artifacts
      : [];

  return (
    <div className="mt-2 space-y-2.5 text-sm leading-7">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <div
              key={`code-${index}`}
              className="overflow-hidden rounded-2xl border border-foreground/10 bg-foreground text-primary-foreground"
            >
              {block.language ? (
                <div className="border-b border-card/10 px-4 py-2 text-xs font-semibold uppercase -wide text-primary-foreground/60">
                  {block.language}
                </div>
              ) : null}
              <div className="custom-scrollbar overflow-x-auto px-4 py-4">
                <pre className="w-fit min-w-full whitespace-pre font-mono text-xs leading-5">
                  {block.code}
                </pre>
              </div>
            </div>
          );
        }

        if (block.type === "image" || block.type === "chart" || block.type === "file") {
          const artifact = findArtifact(artifacts, block.artifactRole);
          if (artifact && isSuppressedTranscriptArtifact(artifact)) {
            return null;
          }
          if (!artifact) {
            return (
              <div
                key={`${block.type}-${index}`}
                className="rounded-2xl border border-dashed border-border bg-muted px-4 py-4 text-sm leading-6 text-muted-foreground"
              >
                <code>{block.artifactRole}</code>에 대한 아티팩트 메타데이터를 사용할 수 없습니다.
              </div>
            );
          }

          return (
            <ArtifactPreviewCard
              key={`${block.type}-${index}`}
              artifact={artifact}
              runId={"runId" in props.message ? props.message.runId ?? null : null}
              showInspectLink={false}
              variant="compact"
            />
          );
        }

        if (!block.text.trim()) {
          return null;
        }

        return (
          <p
            key={`text-${index}`}
            className="whitespace-pre-wrap text-sm leading-7 text-inherit"
          >
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function assistantArtifacts(
  artifacts: AgentSessionArtifactManifestEntry[] | undefined
): {
  visibleArtifacts: AgentSessionArtifactManifestEntry[];
  hiddenArtifactCount: number;
} {
  return splitTranscriptArtifacts(artifacts);
}

function WorkspacePathButton(props: {
  path: string;
  pathKind: WorkspacePathKind;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePathKind) => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    props.onOpenWorkspacePath(props.path, props.pathKind);
  }

  const icon =
    props.pathKind === "directory" ? (
      <Folder size={10} />
    ) : props.pathKind === "file" ? (
      <File size={10} />
    ) : (
      <Share2 size={10} />
    );

  return (
    <code
      role="button"
      tabIndex={0}
      onClick={() => props.onOpenWorkspacePath(props.path, props.pathKind)}
      onKeyDown={handleKeyDown}
      className={cn(
        "inline rounded-md bg-secondary px-1.5 py-0 align-baseline font-mono text-xs text-foreground break-words transition",
        "cursor-pointer hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
      )}
      title={`공유 워크스페이스에서 ${props.path} 열기`}
      aria-label={`공유 워크스페이스에서 ${props.path} 열기`}
    >
      <span className="mr-1 inline-block align-baseline text-muted-foreground/60">{icon}</span>
      <span className="break-all">
        {props.path}
      </span>
    </code>
  );
}

function renderWorkspaceLinkedChildren(
  children: ReactNode,
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePathKind) => void
): ReactNode {
  return Children.toArray(children).map((child, childIndex) => {
    if (typeof child === "string") {
      return splitTextWithWorkspacePaths(child).map((segment, segmentIndex) => {
        if (segment.kind === "text") {
          return segment.value;
        }

        return (
          <WorkspacePathButton
            key={`${segment.path}:${childIndex}:${segmentIndex}`}
            path={segment.path}
            pathKind={segment.pathKind}
            onOpenWorkspacePath={onOpenWorkspacePath}
          />
        );
      });
    }

    if (!isValidElement<{ children?: ReactNode }>(child)) {
      return child;
    }

    if (typeof child.type === "string" && (child.type === "a" || child.type === "code")) {
      return child;
    }

    const childChildren = child.props.children;
    if (childChildren === undefined) {
      return child;
    }

    return cloneElement(child, {
      children: renderWorkspaceLinkedChildren(childChildren, onOpenWorkspacePath),
    });
  });
}

function resolveInlineWorkspacePath(
  value: string
): { path: string; pathKind: WorkspacePathKind } | null {
  const segments = splitTextWithWorkspacePaths(value);
  if (
    segments.length === 1 &&
    segments[0]?.kind === "workspace-path" &&
    segments[0].value === value
  ) {
    return {
      path: segments[0].path,
      pathKind: segments[0].pathKind,
    };
  }

  return null;
}

function AssistantSection(props: {
  section: AssistantTranscriptSection;
  runId: string | null;
  workspaceRoot: string;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePathKind) => void;
  onPreviewArtifact?: (
    runId: string | null,
    artifact: AgentSessionArtifactManifestEntry
  ) => boolean | Promise<boolean>;
}) {
  const {
    visibleArtifacts: artifacts,
    hiddenArtifactCount,
  } = assistantArtifacts(props.section.artifacts);
  const markdown = props.section.pending
    ? normalizeStreamingMarkdown(props.section.content)
    : props.section.content;
  const showPlaceholder = props.section.pending && !props.section.content.trim();

  return (
    <div className="space-y-3">
      {!showPlaceholder ? (
        <div className="text-sm leading-7 text-muted-foreground">
          <ReactMarkdown
            components={{
              h1: ({ children }) => (
                <h1 className="mt-5 text-sm font-semibold font-semibold leading-tight text-foreground first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mt-5 text-base font-semibold leading-tight text-foreground first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-4 text-sm font-semibold uppercase  text-muted-foreground first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </h3>
              ),
              p: ({ children }) => (
                <p className="mt-3 text-sm leading-7 first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-7 first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </ol>
              ),
              li: ({ children }) => (
                <li className="pl-1">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </li>
              ),
              blockquote: ({ children }) => (
                <blockquote className="mt-4 border-l-2 border-border pl-4 text-muted-foreground first:mt-0">
                  {renderWorkspaceLinkedChildren(children, props.onOpenWorkspacePath)}
                </blockquote>
              ),
              a: ({ children, href }) => (
                <WorkspaceAwareMarkdownLink
                  href={href}
                  workspaceRoot={props.workspaceRoot}
                  onOpenWorkspacePath={props.onOpenWorkspacePath}
                  className="inline border-0 bg-transparent p-0 font-medium text-secondary-foreground underline decoration-foreground/50 underline-offset-3 transition hover:text-secondary-foreground"
                >
                  {children}
                </WorkspaceAwareMarkdownLink>
              ),
              hr: () => <hr className="my-4 border-border" />,
              pre: ({ children }) => <>{children}</>,
              code: (codeProps) => {
                const className = codeProps.className ?? "";
                const language = /language-([a-zA-Z0-9_-]+)/.exec(className)?.[1] ?? null;
                const codeText =
                  typeof codeProps.children === "string"
                    ? codeProps.children
                    : Array.isArray(codeProps.children)
                      ? codeProps.children
                        .map((child) => (typeof child === "string" ? child : ""))
                        .join("")
                      : "";
                const isBlockCode = Boolean(language) || codeText.includes("\n");

                if (!isBlockCode) {
                  const singleChild =
                    Array.isArray(codeProps.children) && codeProps.children.length === 1
                      ? codeProps.children[0]
                      : codeProps.children;
                  if (isValidElement(singleChild)) {
                    return singleChild;
                  }

                  const inlineWorkspacePath = resolveInlineWorkspacePath(codeText);
                  if (inlineWorkspacePath) {
                    return (
                      <WorkspacePathButton
                        path={inlineWorkspacePath.path}
                        pathKind={inlineWorkspacePath.pathKind}
                        onOpenWorkspacePath={props.onOpenWorkspacePath}
                      />
                    );
                  }

                  return (
                    <code className="inline rounded-md bg-secondary px-1.5 py-0 align-baseline font-mono text-xs text-foreground break-words">
                      {codeProps.children}
                    </code>
                  );
                }

                return (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-foreground/80 bg-foreground text-primary-foreground shadow-md first:mt-0">
                    {language ? (
                      <div className="border-b border-card/10 px-4 py-2 text-xs font-semibold uppercase -wide text-primary-foreground/60">
                        {language}
                      </div>
                    ) : null}
                    <div className="custom-scrollbar overflow-x-auto px-4 py-4">
                      <pre className="w-fit min-w-full whitespace-pre font-mono text-xs leading-5">
                        <code>{codeProps.children}</code>
                      </pre>
                    </div>
                  </div>
                );
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
          {props.section.pending ? (
            <div className="mt-3 text-secondary-foreground">
              <span className="ia-streaming-dots" aria-label="어시스턴트가 응답을 생성하고 있습니다">
                <span className="ia-streaming-dot" />
                <span className="ia-streaming-dot" />
                <span className="ia-streaming-dot" />
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-secondary-foreground">
          <span className="ia-streaming-dots" aria-label="어시스턴트가 응답을 생성하고 있습니다">
            <span className="ia-streaming-dot" />
            <span className="ia-streaming-dot" />
            <span className="ia-streaming-dot" />
          </span>
        </div>
      )}

      {artifacts.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {artifacts.map((artifact) => (
            <ArtifactPreviewCard
              key={artifact.role}
              artifact={artifact}
              runId={props.runId}
              showInspectLink={false}
              variant="compact"
              onPreview={
                props.onPreviewArtifact
                  ? () => props.onPreviewArtifact?.(props.runId, artifact) ?? false
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantMessageBubble(props: {
  runId: string | null;
  sections: AssistantTranscriptSection[];
  pending?: boolean;
  elapsedLabel?: string | null;
  workspaceRoot: string;
  onOpenWorkspacePath: (path: string, pathKind: WorkspacePathKind) => void;
  onPreviewArtifact?: (
    runId: string | null,
    artifact: AgentSessionArtifactManifestEntry
  ) => boolean | Promise<boolean>;
}) {
  if (props.sections.length === 0) {
    return null;
  }

  return (
    <Card className="max-w-full gap-0 break-words bg-card/95 px-5 py-4 text-foreground">
      <div className={cn(CHAT_MESSAGE_META_ROW_CLASS, "text-muted-foreground")}>
        <span className={CHAT_MESSAGE_ROLE_LABEL_CLASS}>{messageRoleLabel("assistant")}</span>
        {props.elapsedLabel ? (
          <Badge className={cn(CHAT_MESSAGE_META_BADGE_CLASS, "bg-secondary text-muted-foreground")}>
            경과 {props.elapsedLabel}
          </Badge>
        ) : null}
        {props.runId ? <RunInspectorIconLink runId={props.runId} role="assistant" /> : null}
      </div>

      <div className="mt-3 space-y-4">
        {props.sections.map((section, index) => (
          <div
            key={section.id}
            className={index > 0 ? "border-t border-border pt-4" : ""}
          >
            <AssistantSection
              section={section}
              runId={props.runId}
              workspaceRoot={props.workspaceRoot}
              onOpenWorkspacePath={props.onOpenWorkspacePath}
              onPreviewArtifact={props.onPreviewArtifact}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

function transcriptRowClass(role: "assistant" | "user"): string {
  return role === "assistant"
    ? "flex w-full justify-start pr-5 md:pr-10"
    : "flex w-full justify-end pl-5 md:pl-10";
}

function MessageBubble(props: {
  message: AgentSessionMessage | PendingMessage;
  pending?: boolean;
  onRerun?: (message: AgentSessionMessage | PendingMessage) => Promise<void> | void;
  rerunDisabled?: boolean;
}) {
  const structured =
    ("blocks" in props.message && Array.isArray(props.message.blocks))
      ? props.message.blocks.some((block) => block.type !== "text") ||
      props.message.blocks.some((block) => block.type === "text" && block.text.length > 240)
      : hasCodeBlocks(props.message.content);
  const runId = "runId" in props.message ? props.message.runId : null;
  const canRerun =
    props.message.role === "user" && !props.pending && Boolean(props.onRerun);

  return (
    <div
      className={cn(
        "break-words rounded-3xl border px-4 py-3.5 shadow-md",
        structured ? "max-w-full" : "max-w-11/12",
        props.message.role === "assistant"
          ? "border-border/90 bg-card/95 text-foreground"
          : "border-accent/85 bg-accent text-accent-foreground shadow-sm",
      )}
    >
      <div className={cn(CHAT_MESSAGE_META_ROW_CLASS, "opacity-60")}>
        <span className={CHAT_MESSAGE_ROLE_LABEL_CLASS}>
          {messageRoleLabel(props.message.role)}
        </span>
        {props.pending ? (
          <Badge
            className={cn(
              CHAT_MESSAGE_META_BADGE_CLASS,
              props.message.role === "assistant"
                ? "bg-foreground/10 text-muted-foreground"
                : "bg-card/65 text-muted-foreground",
            )}
          >
            실시간
          </Badge>
        ) : null}
        {canRerun ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              `h-auto ${CHAT_MESSAGE_META_BADGE_CLASS} border`,
              inspectorLinkTone(props.message.role),
            )}
            disabled={props.rerunDisabled}
            onClick={() => {
              void props.onRerun?.(props.message);
            }}
            title="같은 사용자 요청 다시 실행"
          >
            <RotateCcw size={11} />
            다시 실행
          </Button>
        ) : null}
        {runId ? <RunInspectorIconLink runId={runId} role={props.message.role} /> : null}
      </div>
      <PlainMessageViewer message={props.message} role={props.message.role} />
    </div>
  );
}

function SessionComposer(props: {
  runIsActive: boolean;
  sendPending: boolean;
  cancelPending: boolean;
  runtimeOptions: RuntimeDescriptorRecord[];
  selectedRuntime: RuntimeKind;
  selectedOllamaLaunchTarget: RuntimeOllamaLaunchTarget;
  selectedModel: string;
  selectedModelOption: RuntimeDescriptorRecord["modelOptions"][number] | null;
  modelOptions: RuntimeDescriptorRecord["modelOptions"];
  onRuntimeChange: (value: RuntimeKind) => void;
  onOllamaLaunchTargetChange: (value: RuntimeOllamaLaunchTarget) => void;
  selectedReasoningEffort: string;
  selectedServiceTier: string;
  onModelChange: (value: string | null) => void;
  onReasoningEffortChange: (value: string | null) => void;
  onServiceTierChange: (value: string | null) => void;
  controlsDisabled: boolean;
  errorMessage?: string | null;
  onClearError: () => void;
  onSubmitPrompt: (input: { prompt: string; files: File[] }) => Promise<void>;
  onCancelRun: () => Promise<void>;
}) {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const composerError = selectionError ?? props.errorMessage ?? null;
  const selectedRuntimeOption =
    props.runtimeOptions.find((runtime) => runtime.kind === props.selectedRuntime) ?? null;
  const composerProvider =
    props.selectedModelOption?.provider ?? selectedRuntimeOption?.provider ?? "codex";
  const composerModelLabel = props.selectedModelOption?.label
    ?? (props.modelOptions.length > 0 ? "모델 선택" : runtimeShortLabel(props.selectedRuntime));
  const reasoningLabel = props.selectedReasoningEffort
    ? reasoningEffortLabel[
      props.selectedReasoningEffort as keyof typeof reasoningEffortLabel
    ] ?? props.selectedReasoningEffort
    : "기본";
  const serviceTierLabelText =
    props.selectedRuntime === "ollama" || !props.selectedModelOption?.supportedServiceTiers.length
      ? null
      : serviceTierLabel[
        (props.selectedServiceTier ||
          DEFAULT_SERVICE_TIER_SELECTION) as keyof typeof serviceTierLabel
      ];
  const composerRuntimeSummary =
    props.selectedRuntime === "ollama"
      ? `${runtimeShortLabel(props.selectedRuntime)} · ${ollamaLaunchTargetLabel(
        props.selectedOllamaLaunchTarget
      )}`
      : [
        runtimeShortLabel(props.selectedRuntime),
        reasoningLabel,
        serviceTierLabelText && serviceTierLabelText !== serviceTierLabel.default
          ? serviceTierLabelText
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, MAX_COMPOSER_HEIGHT_PX);
    textarea.style.height = `${Math.max(nextHeight, 52)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_COMPOSER_HEIGHT_PX ? "auto" : "hidden";
  }, [draftPrompt]);

  function handleSelectedFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) {
      return;
    }

    setSelectedFiles((current) => mergeUniqueFiles(current, nextFiles));
    setSelectionError(null);
    props.onClearError();
  }

  function handleRemoveFile(fileToRemove: File) {
    setSelectedFiles((current) =>
      current.filter((file) => fileIdentity(file) !== fileIdentity(fileToRemove))
    );
    setSelectionError(null);
    props.onClearError();
  }

  async function submitPrompt() {
    const prompt = draftPrompt.trim();
    if (!prompt || props.runIsActive || props.sendPending) {
      return;
    }

    await props.onSubmitPrompt({ prompt, files: selectedFiles });
    setDraftPrompt("");
    setSelectedFiles([]);
    setSelectionError(null);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (props.runIsActive || !draftPrompt.trim() || props.sendPending) {
      return;
    }

    void submitPrompt();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submitPrompt();
      }}
      className="mt-3 shrink-0 rounded-[28px] border border-border bg-background/95 px-3 py-3 shadow-sm"
    >
      {selectedFiles.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedFiles.map((file) => (
            <div
              key={fileIdentity(file)}
              className="inline-flex min-w-0 shrink-0 items-center gap-2 rounded-full border border-border/70 bg-muted/60 px-3 py-1.5 text-[11px]"
            >
              <div className="min-w-0">
                <span className="block max-w-56 truncate font-medium text-foreground">
                  {file.name}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`${file.name} 제거`}
                disabled={props.runIsActive || props.sendPending}
                onClick={() => handleRemoveFile(file)}
                className="shrink-0 rounded-full"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <Textarea
          ref={composerRef}
          rows={1}
          value={draftPrompt}
          onChange={(event) => {
            setDraftPrompt(event.target.value);
            if (composerError) {
              props.onClearError();
            }
            if (selectionError) {
              setSelectionError(null);
            }
          }}
          onKeyDown={handleComposerKeyDown}
          disabled={props.runIsActive}
          placeholder="메시지를 입력하세요"
          className="min-h-[72px] rounded-2xl border-0 bg-transparent px-1 py-1 text-sm leading-6 text-foreground shadow-none focus-visible:border-transparent focus-visible:ring-0"
          style={{ minHeight: "72px", maxHeight: `${MAX_COMPOSER_HEIGHT_PX}px` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/70 pt-2">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={props.controlsDisabled}
                className="h-9 max-w-full rounded-full border-border bg-muted/50 px-3 text-left shadow-none hover:bg-muted"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderGlyph provider={composerProvider} className="size-5 shrink-0 text-[10px]" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground">
                      {composerModelLabel}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {composerRuntimeSummary}
                    </div>
                  </div>
                  <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                </div>
              </Button>
            }
          />
          <PopoverContent
            side="top"
            align="start"
            sideOffset={10}
            className="w-[min(34rem,calc(100vw-2rem))] gap-3 rounded-[24px] p-3"
          >
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground">모델 설정</div>
              <div className="text-[11px] text-muted-foreground">
                입력창과 같은 영역에서 실행 엔진과 모델을 바로 조정합니다.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">실행 엔진</div>
                <Select
                  value={props.selectedRuntime}
                  onValueChange={(value) => props.onRuntimeChange(value as RuntimeKind)}
                  disabled={props.controlsDisabled}
                >
                  <SelectTrigger
                    aria-label="실행 엔진"
                    className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                  >
                    <SelectValue className="min-w-0 truncate">
                      {runtimeShortLabel(props.selectedRuntime)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="rounded-3xl">
                    {props.runtimeOptions.map((runtime) => (
                      <SelectItem key={runtime.kind} value={runtime.kind}>
                        <ProviderGlyph provider={runtime.provider} className="size-5 text-[10px]" />
                        <span>{runtime.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {props.selectedRuntime === "ollama" ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">Ollama 실행기</div>
                  <Select
                    value={props.selectedOllamaLaunchTarget}
                    onValueChange={(value) =>
                      props.onOllamaLaunchTargetChange(value as RuntimeOllamaLaunchTarget)
                    }
                    disabled={props.controlsDisabled}
                  >
                    <SelectTrigger
                      aria-label="Ollama 실행기"
                      className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                    >
                      <SelectValue>
                        {ollamaLaunchTargetLabel(props.selectedOllamaLaunchTarget)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-3xl">
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {props.modelOptions.length > 0 ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="text-[11px] font-medium text-muted-foreground">모델</div>
                  <Select
                    value={props.selectedModel}
                    onValueChange={(value) => props.onModelChange(value)}
                    disabled={props.controlsDisabled}
                  >
                    <SelectTrigger
                      aria-label="모델"
                      className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                    >
                      {props.selectedModelOption ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <ProviderGlyph
                            provider={props.selectedModelOption.provider}
                            className="size-4 shrink-0 text-[9px]"
                          />
                          <span className="truncate">{props.selectedModelOption.label}</span>
                        </div>
                      ) : (
                        <SelectValue placeholder="모델 선택" />
                      )}
                    </SelectTrigger>
                    <SelectContent className="rounded-3xl">
                      {props.modelOptions.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          <ProviderGlyph provider={model.provider} className="size-5 text-[10px]" />
                          <span>{model.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {props.selectedModelOption?.supportedReasoningEfforts.length ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">추론</div>
                  <Select
                    value={props.selectedReasoningEffort}
                    onValueChange={props.onReasoningEffortChange}
                    disabled={props.controlsDisabled}
                  >
                    <SelectTrigger
                      aria-label="추론 수준"
                      className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                    >
                      <SelectValue placeholder="기본">
                        {props.selectedReasoningEffort
                          ? reasoningEffortLabel[
                            props.selectedReasoningEffort as keyof typeof reasoningEffortLabel
                          ] ?? props.selectedReasoningEffort
                          : "기본"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-3xl">
                      {props.selectedModelOption.supportedReasoningEfforts.map((effort) => (
                        <SelectItem key={effort} value={effort}>
                          <span>{reasoningEffortLabel[effort]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {props.selectedModelOption?.supportedServiceTiers.length ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">응답 속도</div>
                  <Select
                    value={props.selectedServiceTier}
                    onValueChange={props.onServiceTierChange}
                    disabled={props.controlsDisabled}
                  >
                    <SelectTrigger
                      aria-label="응답 속도"
                      className="h-9 w-full rounded-2xl border-border bg-muted/60 px-3 text-sm"
                    >
                      <SelectValue placeholder="기본">
                        {props.selectedServiceTier &&
                        props.selectedServiceTier !== DEFAULT_SERVICE_TIER_SELECTION
                          ? serviceTierLabel[
                            props.selectedServiceTier as keyof typeof serviceTierLabel
                          ] ?? props.selectedServiceTier
                          : serviceTierLabel.default}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-3xl">
                      <SelectItem value={DEFAULT_SERVICE_TIER_SELECTION}>
                        <span>{serviceTierLabel.default}</span>
                      </SelectItem>
                      {props.selectedModelOption.supportedServiceTiers.map((tier) => (
                        <SelectItem key={tier} value={tier}>
                          <span>{serviceTierLabel[tier]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        <CompactFileAttachmentPicker
          files={selectedFiles}
          disabled={props.runIsActive || props.sendPending}
          buttonLabel="파일 추가"
          inline
          iconOnly
          showFileList={false}
          className="shrink-0"
          onFilesSelected={handleSelectedFiles}
          onRemoveFile={handleRemoveFile}
        />

        <Button
          type={props.runIsActive ? "button" : "submit"}
          aria-label={
            props.runIsActive
              ? props.cancelPending
                ? "실행 취소 중"
                : "실행 취소"
              : props.sendPending
                ? "프롬프트 전송 중"
                : "프롬프트 전송"
          }
          onClick={
            props.runIsActive
              ? () => {
                void props.onCancelRun();
              }
              : undefined
          }
          disabled={
            props.runIsActive
              ? props.cancelPending
              : !draftPrompt.trim() || props.sendPending
          }
          className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {props.runIsActive && props.cancelPending ? (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-card/30 border-t-card bg-transparent p-0"
            />
          ) : null}
          {!props.runIsActive && props.sendPending ? (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-card/30 border-t-card bg-transparent p-0"
            />
          ) : null}
          {props.runIsActive && !props.cancelPending ? (
            <Square size={16} className="fill-current" />
          ) : null}
          {!props.runIsActive && !props.sendPending ? (
            <Send size={16} />
          ) : null}
        </Button>
      </div>

      {composerError ? (
        <p className="mt-2 px-1 text-[11px] text-destructive">
          {composerError}
        </p>
      ) : null}
    </form>
  );
}

function SessionSkillsPanel(props: {
  skills: Array<{
    name: string;
    path: string;
  }>;
  isLoading: boolean;
  errorMessage: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">등록된 스킬</p>
        <p className="mt-1 text-sm text-foreground">
          에이전트 작업 폴더의 <code>.agents/skills/</code> 아래에 있는 스킬과 기본 제공 스킬을 확인할 수 있습니다.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground">에이전트 스킬</p>
        </div>
        {props.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">스킬 목록을 불러오는 중입니다.</p>
        ) : props.errorMessage ? (
          <p className="mt-3 text-sm text-muted-foreground">{props.errorMessage}</p>
        ) : props.skills.length > 0 ? (
          <div className="mt-3 space-y-2">
            {props.skills.map((skill) => (
              <div
                key={skill.path}
                className="rounded-2xl border border-border/70 bg-muted/40 px-3 py-2.5"
              >
                <p className="text-sm font-semibold text-foreground">{skill.name}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                  {skill.path}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            아직 등록된 에이전트 스킬이 없습니다.
          </p>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <LockKeyhole size={15} className="text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground">기본 제공 스킬</p>
        </div>
        <div className="mt-3 space-y-2">
          {BUILT_IN_HARNESS_SKILLS.map((skill) => (
            <div
              key={skill.name}
              className="rounded-2xl border border-border/70 bg-muted/40 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{skill.name}</p>
                <Badge className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                  읽기 전용
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function findArtifact(
  artifacts: AgentSessionArtifactManifestEntry[],
  role: string
): AgentSessionArtifactManifestEntry | null {
  return artifacts.find((artifact) => artifact.role === role) ?? null;
}

export function SessionWorkspacePage() {
  const { agentId, sessionId } = useParams();
  const runtimesQuery = useRuntimesQuery();
  const agentSkillsQuery = useAgentWorkspaceDirectoryQuery(agentId, "skills");
  const sessionQuery = useSessionQuery(sessionId);
  const transcriptQuery = useTranscriptQuery(sessionId);
  const sendMessageMutation = useSendMessageMutation(sessionId);
  const cancelRunMutation = useCancelRunMutation();
  const updateSessionMutation = useUpdateSessionMutation(agentId);
  const sourceRef = useRef<RunEventsSource | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const terminalSyncRunIdRef = useRef<string | null>(null);

  const [optimisticPrompt, setOptimisticPrompt] = useState<string | null>(null);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [assistantCompletedSections, setAssistantCompletedSections] = useState<
    AssistantTranscriptSection[]
  >([]);
  const [activeRun, setActiveRun] = useState<AgentRunRecord | null>(null);
  const [activeResult, setActiveResult] = useState<RuntimeRunResult | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveRunStatus>("idle");
  const [, setRuntimeSessionId] = useState<string | null>(null);
  const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(null);
  const [showWorkspacePanel, setShowWorkspacePanel] = useState(true);
  const [workspaceFocus, setWorkspaceFocus] = useState<{
    directoryPath: string;
    filePath: string | null;
    requestKey: number;
  }>({
    directoryPath: "",
    filePath: null,
    requestKey: 0,
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftSessionTitle, setDraftSessionTitle] = useState("");
  const [saveTaskDialogOpen, setSaveTaskDialogOpen] = useState(false);
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind>("codex-cli");
  const [selectedOllamaLaunchTarget, setSelectedOllamaLaunchTarget] =
    useState<RuntimeOllamaLaunchTarget>("codex");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [selectedServiceTier, setSelectedServiceTier] = useState("");
  const [selectionHydratedSessionId, setSelectionHydratedSessionId] = useState<string | null>(
    null
  );
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [replacedAssistantRunId, setReplacedAssistantRunId] = useState<string | null>(null);

  const handleTerminalSync = useEffectEvent(
    async (runId: string, status: string | null | undefined) => {
      if (!runId) {
        return;
      }

      if (terminalSyncRunIdRef.current === runId) {
        return;
      }

      terminalSyncRunIdRef.current = runId;
      sourceRef.current?.close();
      sourceRef.current = null;
      setLiveStatus(mapRuntimeStatus(status));

      try {
        const [run, result] = await Promise.all([
          agentEngineClient.getRun(runId),
          agentEngineClient.getRunResult(runId),
          sessionQuery.refetch(),
          transcriptQuery.refetch(),
        ]);

        startTransition(() => {
          setActiveRun(run);
          setActiveResult(result);
          setRuntimeSessionId(
            result.sessionBinding?.runtimeSessionId ?? result.runtimeSessionId ?? null
          );
          setOptimisticPrompt(null);
          setReplacedAssistantRunId(null);
          setAssistantDraft("");
          setAssistantCompletedSections([]);
        });
      } catch (error) {
        setLiveStatus("failed");
      } finally {
        if (terminalSyncRunIdRef.current === runId) {
          terminalSyncRunIdRef.current = null;
        }
      }
    }
  );

  const syncActiveRunState = useEffectEvent(async () => {
    if (!activeRun?.id) {
      return;
    }

    try {
      const run = await agentEngineClient.getRun(activeRun.id);

      if (!isTerminalRunStatus(run.status)) {
        setActiveRun((current) => (current?.id === run.id ? run : current));
        return;
      }

      await handleTerminalSync(run.id, run.status);
    } catch {
      // Keep the current UI state and let the next poll retry.
    }
  });

  const handleRuntimeEvent = useEffectEvent((event: RuntimeEvent) => {
    if (event.type === "session.bound") {
      const boundSessionId = eventString(event.data, "runtimeSessionId");
      if (boundSessionId) {
        setRuntimeSessionId(boundSessionId);
      }
      return;
    }

    if (event.type === "run.started") {
      setLiveStatus("streaming");
      return;
    }

    if (event.type === "assistant.message.delta") {
      const delta = eventString(event.data, "text");
      if (delta) {
        setAssistantDraft((current) => `${current}${delta}`);
      }
      return;
    }

    if (event.type === "assistant.message.completed") {
      const text = eventString(event.data, "text");
      if (text !== null && text.trim()) {
        setAssistantCompletedSections((current) => [
          ...current,
          {
            id: `${event.runId ?? activeRun?.id ?? "live"}:assistant:${current.length + 1}`,
            content: text,
            source: String(event.rawType ?? event.type),
            createdAt: event.occurredAt,
          },
        ]);
        setAssistantDraft("");
      }
      return;
    }

    if (event.type === "run.error") {
      setLiveStatus("failed");
      return;
    }

    if (
      event.type === "run.completed" &&
      (event.rawType === "process.close" || eventString(event.data, "status"))
    ) {
      void handleTerminalSync(
        event.runId ?? activeRun?.id ?? "",
        eventString(event.data, "status")
      );
    }
  });

  const handleStreamError = useEffectEvent((message?: string) => {
    if (liveStatus === "completed" || liveStatus === "failed" || liveStatus === "cancelled") {
      return;
    }

    void message;
    sourceRef.current?.close();
    sourceRef.current = null;
    void syncActiveRunState();
  });

  useEffect(() => {
    if (!activeRun?.id || !isRunStreamable(activeRun)) {
      return;
    }

    const source = new RunEventsSource(activeRun.id, {
      onEvent: handleRuntimeEvent,
      onError: handleStreamError,
    });
    sourceRef.current = source;

    return () => {
      if (sourceRef.current === source) {
        sourceRef.current = null;
      }
      source.close();
    };
  }, [activeRun?.id, activeRun?.status]);

  const session = sessionQuery.data;
  const runtimeDescriptor = useMemo(
    () => runtimesQuery.data?.find((runtime) => runtime.kind === selectedRuntime) ?? null,
    [runtimesQuery.data, selectedRuntime]
  );
  const selectedModelOption = useMemo(
    () =>
      runtimeDescriptor?.modelOptions.find((model) => model.id === selectedModel) ?? null,
    [runtimeDescriptor, selectedModel]
  );
  const transcript = transcriptQuery.data ?? [];
  const runIsActive = liveStatus === "sending" || liveStatus === "streaming";
  const transcriptMessages = transcript.filter(
    (message) =>
      !(
        replacedAssistantRunId &&
        message.role === "assistant" &&
        message.runId === replacedAssistantRunId
      )
  );
  const transcriptEntries = buildTranscriptDisplayEntries(transcriptMessages);
  const transcriptRunIds = [...new Set(
    transcriptMessages.flatMap((message) =>
      typeof message.runId === "string" && message.runId.length > 0
        ? [message.runId]
        : []
    )
  )];
  const transcriptRunQueries = useQueries({
    queries: transcriptRunIds.map((runId) => ({
      queryKey: agentEngineQueryKeys.run(runId),
      queryFn: () => agentEngineClient.getRun(runId),
      enabled: Boolean(sessionId),
      staleTime: 30_000,
    })),
  });
  const latestTranscriptRunId =
    [...transcriptMessages].reverse().find((message) => message.runId)?.runId ?? null;
  const persistedRuntimeSessionId = session?.runtimeSessionId ?? null;
  const isArchivedSession = session?.lifecycle === "archived";
  const transcriptRunsById: Record<string, AgentRunRecord> = {};
  transcriptRunQueries.forEach((query, index) => {
    if (query.data) {
      transcriptRunsById[transcriptRunIds[index]] = query.data;
    }
  });
  if (activeRun?.id) {
    transcriptRunsById[activeRun.id] = activeRun;
  }
  const liveElapsedLabel = formatElapsedDuration(
    activeRun?.startedAt ?? null,
    runIsActive ? null : activeResult?.endedAt ?? activeRun?.endedAt ?? null,
    clockNow
  );
  const elapsedLabelForRun = (runId: string | null | undefined): string | null => {
    if (!runId) {
      return null;
    }

    if (runId === activeRun?.id) {
      return liveElapsedLabel;
    }

    const run = transcriptRunsById[runId];
    return run
      ? formatElapsedDuration(run.startedAt, run.endedAt, clockNow)
      : null;
  };
  const liveAssistantSections = [
    ...assistantCompletedSections,
    ...(runIsActive || assistantDraft
      ? [
        {
          id: `${activeRun?.id ?? "pending"}:assistant-live-draft`,
          content: assistantDraft,
          source: "live-stream",
          createdAt: new Date(clockNow).toISOString(),
          pending: true,
        } satisfies AssistantTranscriptSection,
      ]
      : []),
  ];
  const lastUserPrompt =
    [...transcriptMessages]
      .reverse()
      .find((message) => message.role === "user" && message.content.trim())?.content ?? "";

  useEffect(() => {
    if (
      !session ||
      !runtimesQuery.data ||
      selectionHydratedSessionId === session.id
    ) {
      return;
    }

    const persistedSelection = readSessionRuntimeSelection(session.id);
    const nextRuntime = persistedSelection?.runtimeKind ?? session.runtimeKind;
    const nextOllamaLaunchTarget =
      nextRuntime === "ollama"
        ? persistedSelection?.ollamaLaunchTarget ??
          session.runtimeConfig.ollamaLaunchTarget ??
          "codex"
        : "codex";
    const nextRuntimeDescriptor =
      runtimesQuery.data.find((runtime) => runtime.kind === nextRuntime) ?? null;
    const nextModel = resolveModelSelection(
      nextRuntimeDescriptor,
      persistedSelection ? persistedSelection.model : session.runtimeConfig.model
    );
    const nextModelOption =
      nextRuntimeDescriptor?.modelOptions.find((model) => model.id === nextModel) ?? null;
    const nextReasoningEffort =
      nextRuntime === "ollama"
        ? ""
        : resolveModelReasoningEffort(
          nextModelOption,
          persistedSelection
            ? persistedSelection.reasoningEffort
            : session.runtimeConfig.reasoningEffort ?? ""
        );
    const nextServiceTier =
      nextRuntime === "ollama"
        ? ""
        : resolveModelServiceTier(
          nextModelOption,
          persistedSelection
            ? persistedSelection.serviceTier
            : session.runtimeConfig.serviceTier ?? ""
        );

    setSelectedRuntime(nextRuntime);
    setSelectedOllamaLaunchTarget(nextOllamaLaunchTarget);
    setSelectedModel(nextModel);
    setSelectedReasoningEffort(nextReasoningEffort);
    setSelectedServiceTier(nextServiceTier);
    setSelectionHydratedSessionId(session.id);
  }, [
    selectionHydratedSessionId,
    runtimesQuery.data,
    session?.id,
    session?.runtimeKind,
    session?.runtimeConfig.model,
    session?.runtimeConfig.ollamaLaunchTarget,
    session?.runtimeConfig.reasoningEffort,
    session?.runtimeConfig.serviceTier,
  ]);

  useEffect(() => {
    setSelectedModel((current) => resolveModelSelection(runtimeDescriptor, current));
  }, [runtimeDescriptor]);

  useEffect(() => {
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(selectedModelOption, current)
    );
    setSelectedServiceTier((current) =>
      resolveModelServiceTier(selectedModelOption, current)
    );
  }, [selectedModelOption]);

  useEffect(() => {
    if (!session?.id || selectionHydratedSessionId !== session.id) {
      return;
    }

    writeSessionRuntimeSelection(session.id, {
      runtimeKind: selectedRuntime,
      ollamaLaunchTarget:
        selectedRuntime === "ollama" ? selectedOllamaLaunchTarget : null,
      model: selectedModel || null,
      reasoningEffort:
        selectedRuntime === "ollama" ? null : selectedReasoningEffort || null,
      serviceTier:
        selectedRuntime === "ollama" ? null : selectedServiceTier || null,
    });
  }, [
    selectionHydratedSessionId,
    selectedModel,
    selectedOllamaLaunchTarget,
    selectedReasoningEffort,
    selectedRuntime,
    selectedServiceTier,
    session?.id,
  ]);

  useEffect(() => {
    if (!activeRun?.id || !runIsActive) {
      return;
    }

    const timer = window.setInterval(() => {
      void syncActiveRunState();
    }, ACTIVE_RUN_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeRun?.id, runIsActive]);

  useEffect(() => {
    if (!runIsActive || !activeRun?.startedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeRun?.startedAt, runIsActive]);

  useEffect(() => {
    const container = transcriptScrollRef.current;
    if (!container) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: runIsActive ? "auto" : "smooth",
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    assistantCompletedSections.length,
    assistantDraft.length,
    optimisticPrompt,
    runIsActive,
    transcriptMessages.length,
  ]);

  useEffect(() => {
    if (!isEditingTitle) {
      setDraftSessionTitle(session?.title ?? "");
    }
  }, [isEditingTitle, session?.title]);

  useEffect(() => {
    if (!session || !latestTranscriptRunId || runIsActive) {
      return;
    }

    if (activeRun?.id === latestTranscriptRunId && activeResult) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const run = await agentEngineClient.getRun(latestTranscriptRunId);

        if (cancelled) {
          return;
        }

        if (isRunStreamable(run)) {
          startTransition(() => {
            setActiveRun(run);
            setActiveResult(null);
            setLiveStatus("streaming");
            setRuntimeSessionId(run.runtimeSessionId ?? persistedRuntimeSessionId);
          });
          return;
        }

        const result = await agentEngineClient.getRunResult(latestTranscriptRunId);

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setActiveRun(run);
          setActiveResult(result);
          setRuntimeSessionId(
            result.sessionBinding?.runtimeSessionId ??
            result.runtimeSessionId ??
            persistedRuntimeSessionId
          );
          setLiveStatus(mapRuntimeStatus(result.status));
        });
      } catch {
        if (cancelled) {
          return;
        }

        setLiveStatus("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeResult,
    activeRun?.id,
    latestTranscriptRunId,
    persistedRuntimeSessionId,
    runIsActive,
    session,
  ]);

  if (!agentId || !sessionId) {
    return (
      <PageState
        eyebrow="누락"
        title="작업 요청 라우트가 불완전합니다"
        description="워크스페이스 라우트에는 에이전트 ID와 작업 요청 ID가 모두 필요합니다."
      />
    );
  }

  if (sessionQuery.isLoading || transcriptQuery.isLoading) {
    return (
      <PageState
        eyebrow="로딩"
        title="워크스페이스 열기"
        description="트랜스크립트와 작업 요청 메타데이터를 로딩하여 전체 워크스페이스를 구성합니다."
      />
    );
  }

  if (sessionQuery.isError || transcriptQuery.isError) {
    const error = sessionQuery.error ?? transcriptQuery.error;
    return (
      <PageState
        eyebrow="오류"
        title="작업 요청을 열 수 없습니다"
        description={
          error instanceof Error ? error.message : "작업 요청 워크스페이스 요청에 실패했습니다."
        }
      />
    );
  }

  if (!session) {
    return (
      <PageState
        eyebrow="누락"
        title="작업 요청을 찾을 수 없습니다"
        description="이 워크스페이스는 요청된 작업 기록이 존재해야 열 수 있습니다."
      />
    );
  }

  function resolveExecutionSelection(input: {
    runtimeKind?: RuntimeKind;
    ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
    model?: string | null;
    reasoningEffort?: string | null;
    serviceTier?: string | null;
  } = {}) {
    const runtimeKind = input.runtimeKind ?? selectedRuntime;
    const descriptor =
      runtimesQuery.data?.find((runtime) => runtime.kind === runtimeKind) ?? null;
    const model = resolveModelSelection(
      descriptor,
      input.model ?? selectedModel ?? null
    );
    const modelOption =
      descriptor?.modelOptions.find((entry) => entry.id === model) ?? null;
    const reasoningEffortSelection =
      runtimeKind === "ollama"
        ? ""
        : resolveModelReasoningEffort(
          modelOption,
          input.reasoningEffort ?? selectedReasoningEffort
        );
    const serviceTierSelection =
      runtimeKind === "ollama"
        ? ""
        : resolveModelServiceTier(
          modelOption,
          input.serviceTier ?? selectedServiceTier
        );

    return {
      runtimeKind,
      ollamaLaunchTarget:
        runtimeKind === "ollama"
          ? input.ollamaLaunchTarget ?? selectedOllamaLaunchTarget
          : null,
      model,
      modelOption,
      reasoningEffortSelection,
      reasoningEffort: reasoningEffortSelection || null,
      serviceTierSelection,
      serviceTier:
        serviceTierSelection === DEFAULT_SERVICE_TIER_SELECTION
          ? null
          : serviceTierSelection || null,
    };
  }

  function handleRuntimeSelectionChange(nextRuntime: RuntimeKind) {
    const nextDescriptor =
      runtimesQuery.data?.find((runtime) => runtime.kind === nextRuntime) ?? null;
    const nextModel = resolveModelSelection(nextDescriptor, selectedModel);
    const nextModelOption =
      nextDescriptor?.modelOptions.find((model) => model.id === nextModel) ?? null;

    setSelectedRuntime(nextRuntime);
    setSelectedModel(nextModel);
    setSelectedReasoningEffort((current) =>
      resolveModelReasoningEffort(nextModelOption, current)
    );
    setSelectedServiceTier((current) =>
      resolveModelServiceTier(nextModelOption, current)
    );
  }

  async function submitPrompt(input: {
    prompt: string;
    files: File[];
    reuseMessageId?: string;
    replacedAssistantRunId?: string | null;
    runtimeKind?: RuntimeKind;
    ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
    model?: string | null;
    reasoningEffort?: string | null;
    serviceTier?: string | null;
    optimistic?: boolean;
  }) {
    const currentSession = session;
    const prompt = input.prompt.trim();

    if (!currentSession || isArchivedSession) {
      return;
    }

    if (!prompt) {
      return;
    }

    const execution = resolveExecutionSelection(input);

    setLiveStatus("sending");
    setOptimisticPrompt(input.optimistic === false ? null : prompt);
    setAssistantDraft("");
    setAssistantCompletedSections([]);
    setActiveRun(null);
    setActiveResult(null);
    setSendErrorMessage(null);
    setSelectedRuntime(execution.runtimeKind);
    setSelectedOllamaLaunchTarget(execution.ollamaLaunchTarget ?? "codex");
    setSelectedModel(execution.model);
    setSelectedReasoningEffort(execution.reasoningEffortSelection);
    setSelectedServiceTier(execution.serviceTierSelection);
    setReplacedAssistantRunId(input.replacedAssistantRunId ?? null);

    try {
      const run = await sendMessageMutation.mutateAsync({
        agentId: currentSession.agentId,
        prompt,
        files: input.files,
        runtimeKind: execution.runtimeKind,
        ollamaLaunchTarget: execution.ollamaLaunchTarget,
        model: execution.model || null,
        reasoningEffort: execution.reasoningEffort,
        serviceTier: execution.serviceTier,
        reuseMessageId: input.reuseMessageId,
      });
      setActiveRun(run);
      try {
        await Promise.all([sessionQuery.refetch(), transcriptQuery.refetch()]);
        setOptimisticPrompt(null);
        setReplacedAssistantRunId(null);
      } catch {
        // Keep optimistic state until the next run poll or terminal sync catches up.
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "메시지 전송 요청을 처리하지 못했습니다.";
      setLiveStatus("failed");
      setOptimisticPrompt(null);
      setReplacedAssistantRunId(null);
      setActiveRun(null);
      setSendErrorMessage(detail);
      toast.error("메시지 전송에 실패했습니다", {
        description: detail,
      });
    }
  }

  async function handleRerunMessage(message: AgentSessionMessage | PendingMessage) {
    const currentSession = session;
    if (
      !currentSession ||
      message.role !== "user" ||
      !message.content.trim() ||
      isArchivedSession ||
      runIsActive ||
      sendMessageMutation.isPending ||
      updateSessionMutation.isPending
    ) {
      return;
    }

    await submitPrompt({
      prompt: message.content,
      files: [],
      reuseMessageId: "createdAt" in message ? message.id : undefined,
      replacedAssistantRunId:
        typeof message.runId === "string" && message.runId.length > 0
          ? message.runId
          : null,
      optimistic: false,
    });
  }

  async function handleCancelRun() {
    if (!activeRun) {
      return;
    }

    try {
      const result = await cancelRunMutation.mutateAsync(activeRun.id);
      sourceRef.current?.close();
      sourceRef.current = null;
      setActiveResult(result);
      setLiveStatus(mapRuntimeStatus(result.status));
      setOptimisticPrompt(null);
      setAssistantDraft("");
      setAssistantCompletedSections([]);
      setReplacedAssistantRunId(null);
      setRuntimeSessionId(
        result.sessionBinding?.runtimeSessionId ?? result.runtimeSessionId ?? null
      );
      await Promise.all([sessionQuery.refetch(), transcriptQuery.refetch()]);
    } catch {
      setLiveStatus("failed");
    }
  }

  async function handleSaveSessionTitle() {
    if (!session) {
      return;
    }

    await updateSessionMutation.mutateAsync({
      sessionId: session.id,
      changes: {
        title: draftSessionTitle.trim() || null,
      },
    });
    setIsEditingTitle(false);
  }

  async function handleSessionLifecycleChange(
    lifecycle: "active" | "archived"
  ) {
    if (!session) {
      return;
    }

    const confirmed = window.confirm(
      lifecycle === "archived"
        ? "이 작업 요청을 보관하시겠습니까? 보관 후에는 직접 링크로 계속 볼 수 있지만 읽기 전용이 됩니다."
        : "이 작업 요청을 복구하여 새 프롬프트를 다시 보낼 수 있게 하시겠습니까?"
    );

    if (!confirmed) {
      return;
    }

    await updateSessionMutation.mutateAsync({
      sessionId: session.id,
      changes: {
        lifecycle,
      },
    });
  }

  function focusWorkspacePath(path: string, pathKind: Exclude<WorkspacePathKind, "ambiguous">) {
    setShowWorkspacePanel(true);
    setWorkspaceFocus((current) => ({
      directoryPath:
        pathKind === "file" && path.includes("/")
          ? path.slice(0, path.lastIndexOf("/"))
          : pathKind === "directory"
            ? path
            : "",
      filePath: pathKind === "file" ? path : null,
      requestKey: current.requestKey + 1,
    }));
  }

  async function handleOpenWorkspacePath(path: string, pathKind: WorkspacePathKind) {
    const normalizedPath = path.replace(/^\.\/+/, "").replace(/\/+$/, "");
    if (!normalizedPath) {
      return;
    }

    if (pathKind === "ambiguous" && agentId) {
      try {
        await agentEngineClient.listAgentWorkspace(agentId, normalizedPath);
        focusWorkspacePath(normalizedPath, "directory");
        return;
      } catch {
        // Fall through and try the file preview endpoint.
      }

      try {
        await agentEngineClient.getAgentWorkspaceFilePreview(agentId, normalizedPath);
        focusWorkspacePath(normalizedPath, "file");
        return;
      } catch {
        setShowWorkspacePanel(true);
        setWorkspaceFocus((current) => ({
          directoryPath: "",
          filePath: null,
          requestKey: current.requestKey + 1,
        }));
        return;
      }
    }

    focusWorkspacePath(normalizedPath, pathKind === "directory" ? "directory" : "file");
  }

  async function handleOpenWorkspaceArtifact(
    runId: string | null,
    artifact: AgentSessionArtifactManifestEntry
  ): Promise<boolean> {
    const directPath = artifact.workspaceRelativePath?.trim();
    if (directPath) {
      await handleOpenWorkspacePath(directPath, inferWorkspacePathKind(directPath));
      return true;
    }

    if (!runId || !artifact.role.startsWith("workspace-")) {
      return false;
    }

    let run: AgentRunRecord | null = transcriptRunsById[runId] ?? null;
    if (!run) {
      try {
        run = await agentEngineClient.getRun(runId);
      } catch {
        run = null;
      }
    }

    if (!run) {
      if (!artifact.previewable) {
        toast.error("작업 환경 파일 미리보기를 열 수 없습니다.");
        return true;
      }
      return false;
    }

    try {
      const result = await agentEngineClient.getRunResult(runId);
      const artifactRef = result.artifactRefs.find((entry) => entry.role === artifact.role);
      const workspacePath = artifactRef
        ? extractWorkspaceRelativeArtifactPath(artifactRef.path, run.artifactsDir)
        : null;

      if (!workspacePath) {
        if (!artifact.previewable) {
          toast.error("작업 환경 파일 미리보기를 열 수 없습니다.");
          return true;
        }
        return false;
      }

      await handleOpenWorkspacePath(workspacePath, inferWorkspacePathKind(workspacePath));
      return true;
    } catch {
      if (!artifact.previewable) {
        toast.error("작업 환경 파일 미리보기를 열 수 없습니다.");
        return true;
      }
      return false;
    }
  }

  const harnessSkills = (agentSkillsQuery.data?.entries ?? [])
    .filter((entry) => entry.kind === "directory")
    .map((entry) => ({
      name: entry.name,
      path: `${entry.path}/SKILL.md`,
    }));
  const workspacePanelToggleLabel = showWorkspacePanel
    ? "오른쪽 패널 접기"
    : "오른쪽 패널 펼치기";
  const sessionLifecycleBadge =
    session.lifecycle !== "active" ? (
      <Badge
        className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase -wide",
          sessionLifecycleTone(session.lifecycle),
        )}
      >
        {session.lifecycle}
      </Badge>
    ) : null;
  const runtimeStatusBadge =
    liveStatus !== "idle" ? (
      <Badge
        className={cn(
          SESSION_META_PILL_CLASS,
          "border-transparent",
          statusTone(liveStatus),
        )}
      >
        {liveStatus}
      </Badge>
    ) : null;
  const workspacePanelToggleButton = (
    <Button
      onClick={() => setShowWorkspacePanel((current) => !current)}
      aria-label={workspacePanelToggleLabel}
      title={workspacePanelToggleLabel}
      className={cn(
        SESSION_ICON_BUTTON_CLASS,
        sessionActionButtonTone("neutral"),
      )}
    >
      {showWorkspacePanel ? (
        <PanelRightClose size={14} />
      ) : (
        <PanelRightOpen size={14} />
      )}
    </Button>
  );

  return (
    <section
      className={cn(
        "grid h-full max-h-full min-h-0 gap-4 overflow-hidden p-1",
        showWorkspacePanel
          ? "items-stretch lg:grid-cols-workspace"
          : "grid-cols-1"
      )}
    >
      <div className="flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border/80 pb-2">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              {isEditingTitle ? (
                <div className="max-w-xl">
                  <Input
                    type="text"
                    value={draftSessionTitle}
                    onChange={(event) => setDraftSessionTitle(event.target.value)}
                    placeholder={session.id}
                    className="rounded-2xl border-border bg-background px-4 py-2.5 text-sm"
                  />
                </div>
              ) : (
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold font-semibold leading-tight text-foreground">
                      {session.title || session.id}
                    </h3>
                    {sessionLifecycleBadge}
                  </div>
                  {runtimeStatusBadge || activeRun || liveElapsedLabel ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      {runtimeStatusBadge}
                      {activeRun ? (
                        <Link
                          to={`/runs/${activeRun.id}`}
                          className={cn(
                            SESSION_META_PILL_CLASS,
                            "no-underline visited:no-underline hover:bg-secondary",
                            runIsActive
                              ? "!text-secondary-foreground visited:!text-secondary-foreground"
                              : "!text-muted-foreground visited:!text-muted-foreground",
                          )}
                          title="최근 대화 상세 열기"
                        >
                          {runIsActive ? (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" />
                          ) : null}
                          <span>{runIsActive ? "실행 중" : "최근 실행"}</span>
                        </Link>
                      ) : null}
                      {liveElapsedLabel ? (
                        <Badge className={SESSION_META_PILL_CLASS}>
                          경과 {liveElapsedLabel}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 self-start">
              {isEditingTitle ? (
                <>
                  <Button
                    onClick={() => setSaveTaskDialogOpen(true)}
                    aria-label="단일 작업으로 저장"
                    title="단일 작업으로 저장"
                    className={cn(
                      SESSION_ICON_BUTTON_CLASS,
                      sessionActionButtonTone("neutral"),
                    )}
                  >
                    <BookOpen size={14} />
                  </Button>
                  <Button
                    onClick={() => {
                      void handleSaveSessionTitle();
                    }}
                    disabled={updateSessionMutation.isPending}
                    aria-label="작업 이름 저장"
                    title="작업 이름 저장"
                    className={cn(
                      SESSION_ICON_BUTTON_CLASS,
                      "bg-primary text-primary-foreground hover:bg-primary/80"
                    )}
                  >
                    <Check size={14} />
                  </Button>
                  <Button
                    onClick={() => {
                      setIsEditingTitle(false);
                      setDraftSessionTitle(session.title ?? "");
                    }}
                    aria-label="제목 편집 취소"
                    title="제목 편집 취소"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-background"
                  >
                    <X size={14} />
                  </Button>
                  {workspacePanelToggleButton}
                </>
              ) : (
                <>
                  <Button
                    onClick={() => {
                      setIsEditingTitle(true);
                      setDraftSessionTitle(session.title ?? "");
                    }}
                    disabled={updateSessionMutation.isPending}
                    aria-label="작업 이름 변경"
                    title="작업 이름 변경"
                    className={cn(
                      SESSION_ICON_BUTTON_CLASS,
                      sessionActionButtonTone("neutral"),
                    )}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    onClick={() => {
                      void handleSessionLifecycleChange(
                        session.lifecycle === "archived" ? "active" : "archived"
                      );
                    }}
                    disabled={updateSessionMutation.isPending || runIsActive}
                    aria-label={
                      session.lifecycle === "archived" ? "작업 요청 복구" : "작업 요청 보관"
                    }
                    title={
                      session.lifecycle === "archived" ? "작업 요청 복구" : "작업 요청 보관"
                    }
                    className={cn(
                      SESSION_ICON_BUTTON_CLASS,
                      sessionActionButtonTone(
                        session.lifecycle === "archived" ? "restore" : "archive"
                      ),
                    )}
                  >
                    {session.lifecycle === "archived" ? (
                      <ArrowUpFromLine size={14} />
                    ) : (
                      <Archive size={14} />
                    )}
                  </Button>
                  {workspacePanelToggleButton}
                </>
              )}
            </div>
          </div>
        </div>

        <div
          ref={transcriptScrollRef}
          className="custom-scrollbar mt-2 min-h-0 max-h-full flex-1 space-y-3 overflow-y-auto p-0.5 pr-2"
        >
          {updateSessionMutation.isError ? (
            <div className="rounded-3xl border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {updateSessionMutation.error instanceof Error
                ? updateSessionMutation.error.message
                : "작업 요청 업데이트 요청에 실패했습니다."}
            </div>
          ) : null}

          {isArchivedSession ? (
            <div className="rounded-3xl border border-border bg-secondary px-5 py-5 text-sm leading-6 text-secondary-foreground">
              이 작업 요청은 보관되었습니다. 트랜스크립트와 공유 파일은 계속 사용 가능하지만,
              복원할 때까지 새 프롬프트가 차단됩니다.
            </div>
          ) : null}

          {transcriptEntries.length === 0 && !optimisticPrompt && liveAssistantSections.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card px-5 py-10 text-sm text-muted-foreground">
              아직 트랜스크립트가 없습니다. 첫 프롬프트를 보내 작업 기록을 시작하세요.
              공유 파일은 워크스페이스 패널에 유지되어 대화가 진행되는 동안 탐색할 수 있습니다.
            </div>
          ) : null}

          {transcriptEntries.map((entry) =>
            entry.kind === "assistant-group" ? (
              <div key={entry.key} className={transcriptRowClass("assistant")}>
                <AssistantMessageBubble
                  runId={entry.runId}
                  sections={entry.sections}
                  elapsedLabel={elapsedLabelForRun(entry.runId)}
                  workspaceRoot={session.workspaceRoot}
                  onOpenWorkspacePath={handleOpenWorkspacePath}
                  onPreviewArtifact={handleOpenWorkspaceArtifact}
                />
              </div>
            ) : entry.message.role === "assistant" ? (
              <div key={entry.key} className={transcriptRowClass("assistant")}>
                <AssistantMessageBubble
                  runId={entry.message.runId ?? null}
                  sections={[
                    {
                      id: entry.message.id,
                      content: entry.message.content,
                      blocks: entry.message.blocks,
                      artifacts: entry.message.artifacts,
                      source: entry.message.source,
                      createdAt: entry.message.createdAt,
                    },
                  ]}
                  elapsedLabel={elapsedLabelForRun(entry.message.runId)}
                  workspaceRoot={session.workspaceRoot}
                  onOpenWorkspacePath={handleOpenWorkspacePath}
                  onPreviewArtifact={handleOpenWorkspaceArtifact}
                />
              </div>
            ) : (
              <div key={entry.key} className={transcriptRowClass("user")}>
                <MessageBubble
                  message={entry.message}
                  onRerun={handleRerunMessage}
                  rerunDisabled={
                    isArchivedSession ||
                    runIsActive ||
                    sendMessageMutation.isPending ||
                    updateSessionMutation.isPending ||
                    !entry.message.content.trim()
                  }
                />
              </div>
            )
          )}

          {optimisticPrompt ? (
            <div className={transcriptRowClass("user")}>
              <MessageBubble
                pending
                message={{
                  id: `${activeRun?.id ?? "pending"}:optimistic-user`,
                  runId: activeRun?.id ?? null,
                  role: "user",
                  content: optimisticPrompt,
                  source: "pending-user-turn",
                }}
              />
            </div>
          ) : null}

          {liveAssistantSections.length > 0 ? (
            <div className={transcriptRowClass("assistant")}>
              <AssistantMessageBubble
                pending
                runId={activeRun?.id ?? null}
                sections={liveAssistantSections}
                elapsedLabel={liveElapsedLabel}
                workspaceRoot={session.workspaceRoot}
                onOpenWorkspacePath={handleOpenWorkspacePath}
                onPreviewArtifact={handleOpenWorkspaceArtifact}
              />
            </div>
          ) : null}
        </div>

        {isArchivedSession ? null : (
          <SessionComposer
            runIsActive={runIsActive}
            sendPending={sendMessageMutation.isPending}
            cancelPending={cancelRunMutation.isPending}
            runtimeOptions={runtimesQuery.data ?? []}
            selectedRuntime={selectedRuntime}
            selectedOllamaLaunchTarget={selectedOllamaLaunchTarget}
            selectedModel={selectedModel}
            selectedModelOption={selectedModelOption}
            modelOptions={runtimeDescriptor?.modelOptions ?? []}
            onRuntimeChange={handleRuntimeSelectionChange}
            onOllamaLaunchTargetChange={setSelectedOllamaLaunchTarget}
            selectedReasoningEffort={selectedReasoningEffort}
            selectedServiceTier={selectedServiceTier}
            onModelChange={(value) => setSelectedModel(value ?? "")}
            onReasoningEffortChange={(value) => setSelectedReasoningEffort(value ?? "")}
            onServiceTierChange={(value) => setSelectedServiceTier(value ?? "")}
            controlsDisabled={
              runIsActive || sendMessageMutation.isPending || updateSessionMutation.isPending
            }
            errorMessage={sendErrorMessage}
            onClearError={() => setSendErrorMessage(null)}
            onSubmitPrompt={submitPrompt}
            onCancelRun={handleCancelRun}
          />
        )}
      </div>

      {showWorkspacePanel ? (
        <Card className="flex min-h-0 max-h-full min-w-0 flex-col gap-0 overflow-hidden bg-card p-0 lg:h-full">
          <Tabs defaultValue="workspace" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="shrink-0 border-b border-border/70 px-4 py-3">
              <TabsList className="rounded-full bg-muted p-1">
                <TabsTrigger value="workspace" className="text-xs">
                  작업 환경
                </TabsTrigger>
                <TabsTrigger value="harness" className="text-xs">
                  하네스
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="workspace" className="min-h-0 flex-1 px-4 py-4">
              <AgentWorkspaceBrowserPanel
                agentId={agentId}
                workspaceRoot={session.workspaceRoot}
                showHeader={false}
                embeddedTitle="작업 환경"
                initialPath={workspaceFocus.directoryPath}
                initialFilePath={workspaceFocus.filePath}
                focusRequestKey={workspaceFocus.requestKey}
              />
            </TabsContent>

            <TabsContent value="harness" className="min-h-0 flex-1 custom-scrollbar overflow-y-auto px-4 py-4">
              <SessionSkillsPanel
                skills={harnessSkills}
                isLoading={agentSkillsQuery.isLoading}
                errorMessage={
                  agentSkillsQuery.isError
                    ? agentSkillsQuery.error instanceof Error
                      ? agentSkillsQuery.error.message
                      : "스킬 목록을 불러오지 못했습니다."
                    : null
                }
              />
            </TabsContent>
          </Tabs>
        </Card>
      ) : null}

      <TaskEditorDialog
        agentId={agentId}
        open={saveTaskDialogOpen}
        onOpenChange={setSaveTaskDialogOpen}
        initialValues={{
          name: session.title ?? "",
          description: "",
          prompt: lastUserPrompt,
          runtimeKind: selectedRuntime,
          ollamaLaunchTarget:
            selectedRuntime === "ollama" ? selectedOllamaLaunchTarget : null,
          model: selectedModel || null,
          reasoningEffort: selectedReasoningEffort || null,
          serviceTier:
            selectedServiceTier === DEFAULT_SERVICE_TIER_SELECTION
              ? null
              : selectedServiceTier || null,
          sourceSessionId: session.id,
        }}
      />
    </section>
  );
}
