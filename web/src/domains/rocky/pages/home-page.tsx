import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  FileText,
  History,
  LayoutTemplate,
  MessageSquare,
  Paperclip,
  PenLine,
  Presentation,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { PptxArtifactPreview } from "@/domains/run/components/pptx-artifact-preview";
import { RunEventsSource } from "@/domains/run/lib/run-events-source";
import {
  useRockyAbilitiesQuery,
  useCancelRockyChatMutation,
  useCreateRockyChatMutation,
  useDeleteRockyChatMutation,
  useRockyChatsQuery,
  useRockyChatQuery,
  useSendRockyMessageMutation,
  useStartRockyAbilityGuideMutation,
} from "@/domains/rocky/hooks";
import {
  defaultRockyRunProgressLabel,
  isTerminalRockyRunEvent,
  rockyRunProgressLabelForEvent,
} from "@/domains/rocky/lib/rocky-run-progress";
import type {
  AgentSessionArtifactManifestEntry,
  AgentSessionMessage,
} from "@/domains/session/types";
import { splitTranscriptArtifacts } from "@/domains/session/lib/transcript-display";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { WorkspaceAwareMarkdownLink } from "@/shared/components/workspace-aware-markdown-link";
import { agentEngineClient } from "@/shared/lib/api-client";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { useMdTemplates } from "@/domains/template/hooks";
import { buildTemplateRunPrompt } from "@/domains/template/lib/md-template-definitions";

import type {
  RockyAbilityCardRecord,
  RockyAttachmentRecord,
  RockyChatRecord,
  RockyMessageRecord,
} from "@/domains/rocky/types";
import type {
  MdTemplateCategory,
  MdTemplateDefinition,
} from "@/domains/template/types";

const LIVE_TRANSCRIPT_REFRESH_INTERVAL_MS = 1500;
const PPT_CONTENT_TYPE = "application/vnd.ms-powerpoint";
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type RockyPreviewPanelSource = {
  contentType: string;
  detail: string;
  downloadHref: string;
  kind: "html" | "powerpoint";
  name: string;
  nativeOpenPath: string | null;
  previewHref?: string | null;
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`));
    };

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to encode file: ${file.name}`));
        return;
      }

      const [, payload = ""] = reader.result.split(",", 2);
      resolve(payload);
    };

    reader.readAsDataURL(file);
  });
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

  return (
    normalizedType === PPT_CONTENT_TYPE ||
    normalizedType === PPTX_CONTENT_TYPE ||
    normalizedName.endsWith(".ppt") ||
    normalizedName.endsWith(".pptx")
  );
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
      nativeOpenPath: null,
    };
  }

  if (isPowerPointArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail: `${artifact.role} · ${artifact.contentType}`,
      downloadHref,
      kind: "powerpoint",
      name: artifact.name,
      nativeOpenPath: `${artifact.downloadUrl}/open-native`,
      previewHref: artifact.previewUrl
        ? agentEngineClient.resolveApiPath(artifact.previewUrl)
        : null,
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

function compactTemplateRunMessage(value: string): string {
  if (!value.startsWith("[Rocky 템플릿 실행]")) {
    return value;
  }

  const title = value.match(/^템플릿:\s*(.+)$/mu)?.[1]?.trim();
  return title ? `템플릿 실행: ${title}` : "템플릿 실행";
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
        nativeOpenPath:
          previewPanelKind === "powerpoint"
            ? agentEngineClient.agentWorkspaceFileNativeOpenPath(agentId, normalizedPath)
            : null,
        previewHref: preview.inlinePreviewUrl
          ? agentEngineClient.resolveApiPath(preview.inlinePreviewUrl)
          : null,
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

function RockyAbilityIcon({ icon }: { icon: RockyAbilityCardRecord["icon"] }) {
  if (icon === "presentation") {
    return <Presentation className="size-4" />;
  }

  return <MessageSquare className="size-4" />;
}

function TemplateCategoryIcon({ category }: { category: MdTemplateCategory }) {
  if (category === "content") {
    return <PenLine className="size-4" />;
  }

  if (category === "data") {
    return <BarChart3 className="size-4" />;
  }

  return <FileText className="size-4" />;
}

function templateTone(category: MdTemplateCategory): string {
  if (category === "content") {
    return "border-rose-500/30 bg-rose-500/8 text-rose-700";
  }

  if (category === "data") {
    return "border-sky-500/30 bg-sky-500/8 text-sky-700";
  }

  return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700";
}

function TemplateCardGrid({
  disabled,
  onSelectTemplate,
  userTemplates,
}: {
  disabled: boolean;
  onSelectTemplate: (template: MdTemplateDefinition) => void;
  userTemplates: MdTemplateDefinition[];
}) {
  return (
    <div className="mt-8 w-full text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">저장한 템플릿</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            카드를 누르면 Rocky가 필요한 값을 순서대로 묻습니다.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link to="/templates/new" />}>
          <Plus className="size-4" />
          템플릿 만들기
        </Button>
      </div>

      {userTemplates.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {userTemplates.map((template) => (
            <TemplateLaunchCard
              key={template.id}
              disabled={disabled}
              template={template}
              onSelectTemplate={onSelectTemplate}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center">
          <div className="text-sm font-medium text-foreground">
            저장한 템플릿이 없습니다.
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            템플릿 메뉴에서 Rocky에게 업무 방식을 알려주면 홈 카드로 실행할 수 있습니다.
          </p>
          <Button className="mt-3" variant="outline" size="sm" render={<Link to="/templates/new" />}>
            <Plus className="size-4" />
            새 템플릿 만들기
          </Button>
        </div>
      )}
    </div>
  );
}

function TemplateLaunchCard({
  disabled,
  onSelectTemplate,
  template,
}: {
  disabled: boolean;
  onSelectTemplate: (template: MdTemplateDefinition) => void;
  template: MdTemplateDefinition;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelectTemplate(template)}
      className="group min-h-40 rounded-lg border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
            templateTone(template.category)
          )}
        >
          <TemplateCategoryIcon category={template.category} />
          <span className="truncate">{template.triggerLabel}</span>
        </span>
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>

      <div className="mt-4 text-sm font-semibold text-foreground">
        {template.title}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {template.description}
      </p>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{template.outputFormatLabel}</span>
      </div>
    </button>
  );
}

function AbilityCardGrid({
  abilities,
  disabled,
  loading,
  onSelectAbility,
}: {
  abilities: RockyAbilityCardRecord[];
  disabled: boolean;
  loading: boolean;
  onSelectAbility: (ability: RockyAbilityCardRecord) => void;
}) {
  if (loading && abilities.length === 0) {
    return (
      <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="h-32 rounded-lg border border-dashed bg-muted/30"
          />
        ))}
      </div>
    );
  }

  if (abilities.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
      {abilities.map((ability) => (
        <button
          key={ability.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelectAbility(ability)}
          className="group min-h-32 rounded-lg border bg-card px-4 py-4 text-left shadow-sm transition hover:border-primary/40 hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
              <RockyAbilityIcon icon={ability.icon} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {ability.title}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {ability.description}
              </span>
            </span>
          </div>

          <ul className="mt-3 space-y-1.5 text-xs leading-5 text-muted-foreground">
            {ability.examples.slice(0, 3).map((example) => (
              <li key={example} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1 rounded-full bg-border" />
                <span>{example}</span>
              </li>
            ))}
          </ul>
        </button>
      ))}
    </div>
  );
}

function EmptyChatState({
  abilities,
  abilitiesLoading,
  disabled,
  onSelectAbility,
  onSelectTemplate,
  userTemplates,
}: {
  abilities: RockyAbilityCardRecord[];
  abilitiesLoading: boolean;
  disabled: boolean;
  onSelectAbility: (ability: RockyAbilityCardRecord) => void;
  onSelectTemplate: (template: MdTemplateDefinition) => void;
  userTemplates: MdTemplateDefinition[];
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center pb-16 text-center">
      <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
        무엇을 도와드릴까요?
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">
        PPT나 자료를 올리고 필요한 일을 편하게 말해 주세요.
      </p>
      <TemplateCardGrid
        disabled={disabled}
        onSelectTemplate={onSelectTemplate}
        userTemplates={userTemplates}
      />
      <div className="mt-8 flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <LayoutTemplate className="size-3.5" />
          Rocky 기본 능력
        </div>
        <div className="h-px flex-1 bg-border" />
      </div>
      <AbilityCardGrid
        abilities={abilities}
        disabled={disabled}
        loading={abilitiesLoading}
        onSelectAbility={onSelectAbility}
      />
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
    return { kind: "pending", text: null, artifacts: [] };
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
    orchestration.output?.trim() ||
    transcriptMessage?.content.trim() ||
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
    <div className="mt-3 flex flex-wrap gap-2">
      {artifacts.map((artifact) => {
        const isPowerPoint = isPowerPointArtifact(artifact);
        const artifactLabel = isPowerPoint
          ? "PPT"
          : isHtmlArtifact(artifact)
            ? "HTML"
            : artifact.presentation === "image"
              ? "이미지"
              : "파일";
        const ArtifactIcon = isPowerPoint ? Presentation : FileText;

        return (
          <button
            key={artifact.role}
            type="button"
            onClick={() => openRockyArtifact(artifact, onOpenPreviewPanel)}
            className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground shadow-sm transition hover:bg-secondary"
          >
            <ArtifactIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-56 truncate">{artifact.name}</span>
            <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {artifactLabel}
            </span>
          </button>
        );
      })}
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
  runProgressByRunId,
  transcriptsBySessionId,
}: {
  agentWorkspaceRootsByAgentId: Record<string, string>;
  chat: RockyChatRecord;
  message: RockyMessageRecord;
  onOpenPreviewPanel: (source: RockyPreviewPanelSource) => void;
  runProgressByRunId: Record<string, string>;
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
    const runId = dispatch?.orchestration?.runId ?? null;
    const progressLabel =
      (runId ? runProgressByRunId[runId] : null) ??
      defaultRockyRunProgressLabel({
        attachmentCount: dispatch?.attachmentIds.length ?? attachments.length,
        skillId: dispatch?.skillId ?? null,
        status: dispatch?.orchestration?.status ?? null,
      });

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
          <div className="mt-1 text-xs leading-5 text-muted-foreground/80">
            현재 {progressLabel}
          </div>
        </article>
      </div>
    );
  }

  const bubbleText =
    !isRocky || rockyMessageState.kind === "pending"
      ? compactTemplateRunMessage(message.text)
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
  runProgressByRunId,
  transcriptsBySessionId,
}: {
  agentWorkspaceRootsByAgentId: Record<string, string>;
  chat: RockyChatRecord;
  endRef: RefObject<HTMLDivElement | null>;
  onOpenPreviewPanel: (source: RockyPreviewPanelSource) => void;
  runProgressByRunId: Record<string, string>;
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
          runProgressByRunId={runProgressByRunId}
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
      {files.map((file) => {
        const FileIcon = isPowerPointFile(file.name, file.type)
          ? Presentation
          : FileText;

        return (
          <span
            key={`${file.name}-${file.size}`}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs"
          >
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
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
        );
      })}
    </div>
  );
}

function ChatComposer({
  canSend,
  canClearChat,
  canLoadHistory,
  canStop,
  chatStarted,
  errorMessage,
  files,
  message,
  onFilesChange,
  onFileRemove,
  onClearChat,
  onOpenHistory,
  onStop,
  onMessageChange,
  onSubmit,
  stopPending,
}: {
  canSend: boolean;
  canClearChat: boolean;
  canLoadHistory: boolean;
  canStop: boolean;
  chatStarted: boolean;
  errorMessage: string | undefined;
  files: File[];
  message: string;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (file: File) => void;
  onClearChat: () => void;
  onOpenHistory: () => void;
  onStop: () => void;
  onMessageChange: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  stopPending: boolean;
}) {
  return (
    <footer className="shrink-0 bg-background px-3 pb-4 pt-2 md:px-6 md:pb-6">
      <div className="mx-auto mb-2 flex w-full max-w-4xl justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canLoadHistory}
          onClick={onOpenHistory}
        >
          <History className="size-4" />
          이전 대화
        </Button>
        {chatStarted ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canClearChat}
            onClick={onClearChat}
          >
            대화 정리
          </Button>
        ) : null}
      </div>

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
            placeholder="PPT나 자료를 넣고 원하는 일을 말해보세요."
            aria-label="Rocky에게 말하기"
            className="max-h-36 min-h-10 flex-1 border-0 bg-transparent px-2 py-2.5 text-sm leading-5 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {canStop || stopPending ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!canStop || stopPending}
              aria-label={stopPending ? "중지 중" : "응답 중지"}
              title={stopPending ? "중지 중" : "응답 중지"}
              className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onStop}
            >
              <Square className="size-4" />
            </Button>
          ) : null}
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

function TemplateExecutionDialog({
  disabled,
  files,
  onFileRemove,
  onFilesChange,
  onOpenChange,
  onStart,
  open,
  template,
}: {
  disabled: boolean;
  files: File[];
  onFileRemove: (file: File) => void;
  onFilesChange: (files: File[]) => void;
  onOpenChange: (open: boolean) => void;
  onStart: (template: MdTemplateDefinition, userBrief: string) => void;
  open: boolean;
  template: MdTemplateDefinition | null;
}) {
  const [userBrief, setUserBrief] = useState("");

  useEffect(() => {
    if (open) {
      setUserBrief("");
    }
  }, [open, template?.id]);

  if (!template) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,44rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>템플릿 실행 준비</DialogTitle>
          <DialogDescription>
            파일과 추가 조건을 먼저 확인한 뒤 Rocky가 필요한 값만 이어서 묻습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className={cn(
                    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
                    templateTone(template.category)
                  )}
                >
                  <TemplateCategoryIcon category={template.category} />
                  <span className="truncate">{template.triggerLabel}</span>
                </div>
                <h2 className="mt-3 text-base font-semibold text-foreground">
                  {template.title}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {template.description}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem]">
            <section className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">실행 전 확인값</h3>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {template.requiredInputs.map((input, index) => (
                  <li key={input} className="flex gap-2 rounded-lg bg-muted/50 px-3 py-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                    <span>{input}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">진행 단계</h3>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {["파일 확인", "누락값 질문", "초안 생성", "수정 반영"].map((step) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary" />
                    {step}
                  </li>
                ))}
              </ol>
              <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                최종 산출물: {template.outputFormatLabel}
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">자료 파일</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  레퍼런스 문서와 원본 자료를 함께 올려도 됩니다.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<label />}
              >
                <Paperclip className="size-4" />
                파일 추가
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="템플릿 실행 자료 파일 선택"
                  onChange={(event) => {
                    onFilesChange(Array.from(event.target.files ?? []));
                  }}
                />
              </Button>
            </div>
            <div className="mt-3">
              <SelectedFileList files={files} onRemove={onFileRemove} />
              {files.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-center text-sm text-muted-foreground">
                  아직 선택한 파일이 없습니다.
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-4 rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">이번 작업 추가 조건</h3>
            <Textarea
              value={userBrief}
              onChange={(event) => setUserBrief(event.target.value)}
              placeholder="예: 4월 행사 기준으로, GS 양식 그대로 맞추고 누락된 가격은 질문해줘."
              className="mt-3 min-h-24"
            />
          </section>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => onStart(template, userBrief)}
          >
            템플릿 실행
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviousChatsDialog({
  chats,
  currentChatId,
  deletingChatId,
  disabled,
  errorMessage,
  loading,
  onDeleteChat,
  onOpenChange,
  onSelectChat,
  open,
}: {
  chats: RockyChatRecord[];
  currentChatId: string | null;
  deletingChatId: string | null;
  disabled: boolean;
  errorMessage: string | null;
  loading: boolean;
  onDeleteChat: (chat: RockyChatRecord) => void;
  onOpenChange: (open: boolean) => void;
  onSelectChat: (chat: RockyChatRecord) => void;
  open: boolean;
}) {
  const hasChats = chats.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,42rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>이전 대화</DialogTitle>
          <DialogDescription>
            저장된 Rocky 대화를 현재 홈 화면에 불러옵니다.
          </DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          {errorMessage ? (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              이전 대화를 불러오는 중입니다.
            </div>
          ) : hasChats ? (
            <div className="grid gap-2">
              {chats.map((chat) => {
                const isCurrentChat = chat.id === currentChatId;
                const itemDisabled = disabled || isCurrentChat;
                const deletePending = deletingChatId === chat.id;
                const deleteDisabled = disabled || Boolean(deletingChatId);

                return (
                  <div
                    key={chat.id}
                    data-testid={`previous-chat-row-${chat.id}`}
                    className={cn(
                      "flex w-full items-stretch overflow-hidden rounded-lg border transition",
                      isCurrentChat
                        ? "border-primary/35 bg-primary/5"
                        : "border-border bg-background"
                    )}
                  >
                    <button
                      type="button"
                      disabled={itemDisabled}
                      onClick={() => onSelectChat(chat)}
                      className={cn(
                        "min-w-0 flex-1 px-4 py-3 text-left transition",
                        itemDisabled
                          ? "cursor-default opacity-70"
                          : "cursor-pointer hover:bg-muted/50"
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {chat.title || "제목 없는 대화"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{chat.messages.length}개 메시지</span>
                            <span aria-hidden="true">·</span>
                            <span>마지막 수정 {formatDateTime(chat.updatedAt)}</span>
                          </div>
                        </div>
                        {isCurrentChat ? (
                          <Badge variant="secondary" className="shrink-0">
                            현재 대화
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center border-l border-border/70 px-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-testid={`previous-chat-delete-${chat.id}`}
                        disabled={deleteDisabled}
                        aria-label={`${chat.title || "제목 없는 대화"} 삭제`}
                        title="대화 삭제"
                        onClick={() => onDeleteChat(chat)}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        {deletePending ? (
                          <span className="text-[10px] font-medium">삭제중</span>
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : errorMessage ? null : (
            <div className="flex min-h-36 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
              불러올 이전 대화가 없습니다.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
  const [nativeOpenPending, setNativeOpenPending] = useState(false);

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
  const nativeOpenLabel = nativeOpenPending
    ? "PowerPoint 여는 중"
    : "PowerPoint에서 열기";

  function openNativePowerPoint(): void {
    if (!source.nativeOpenPath || nativeOpenPending) {
      return;
    }

    setNativeOpenPending(true);
    agentEngineClient
      .openNativeFile(source.nativeOpenPath)
      .then(() => {
        toast.success(`${source.name} 파일을 PowerPoint에서 열었습니다.`);
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "PowerPoint에서 파일을 열지 못했습니다."
        );
      })
      .finally(() => setNativeOpenPending(false));
  }

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
          {source.nativeOpenPath ? (
            <button
              type="button"
              disabled={nativeOpenPending}
              onClick={openNativePowerPoint}
              className="inline-flex rounded-full border border-border bg-background px-3 py-1.5 text-body-sm font-medium text-foreground no-underline transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {nativeOpenLabel}
            </button>
          ) : null}
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
              previewHref={source.previewHref}
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

function chatHasActiveOrchestration(chat: RockyChatRecord): boolean {
  return chat.dispatches.some((dispatch) => {
    const status = dispatch.orchestration?.status;
    return status === "running" || status === "planned";
  });
}

export function HomePage() {
  const [chat, setChat] = useState<RockyChatRecord | null>(null);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [templateExecutionTemplate, setTemplateExecutionTemplate] =
    useState<MdTemplateDefinition | null>(null);
  const [previewPanelSource, setPreviewPanelSource] =
    useState<RockyPreviewPanelSource | null>(null);
  const [suppressAutoSelect, setSuppressAutoSelect] = useState(false);
  const [runProgressByRunId, setRunProgressByRunId] = useState<Record<string, string>>(
    {}
  );
  const submitInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const runProgressSourcesRef = useRef<Map<string, RunEventsSource>>(new Map());
  const abilitiesQuery = useRockyAbilitiesQuery();
  const abilities = abilitiesQuery.data ?? [];
  const { userTemplates } = useMdTemplates();
  const rockyChatsQuery = useRockyChatsQuery();
  const rockyChats = rockyChatsQuery.data;
  const previousChats = rockyChats ?? [];
  const createChatMutation = useCreateRockyChatMutation();
  const deleteHistoryChatMutation = useDeleteRockyChatMutation(null);
  const sendMessageMutation = useSendRockyMessageMutation(chat?.id ?? null);
  const cancelRockyChatMutation = useCancelRockyChatMutation(chat?.id ?? null);
  const startAbilityGuideMutation = useStartRockyAbilityGuideMutation();
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
  const activeRunIds = useMemo(
    () => [
      ...new Set(
        chat?.dispatches.flatMap((dispatch) => {
          const orchestration = dispatch.orchestration;
          if (
            orchestration?.runId &&
            (orchestration.status === "running" ||
              orchestration.status === "planned")
          ) {
            return [orchestration.runId];
          }

          return [];
        }) ?? []
      ),
    ],
    [chat?.dispatches]
  );
  const activeRunIdsKey = activeRunIds.join("\n");
  const mutationPending =
    submitInFlight ||
    createChatMutation.isPending ||
    sendMessageMutation.isPending ||
    startAbilityGuideMutation.isPending ||
    deleteHistoryChatMutation.isPending;
  const pending = mutationPending || cancelRockyChatMutation.isPending;
  const canSend =
    (message.trim().length > 0 || files.length > 0) &&
    !mutationPending &&
    !cancelRockyChatMutation.isPending &&
    !hasActiveOrchestration;
  const canStop =
    Boolean(chat?.id) &&
    hasActiveOrchestration &&
    !cancelRockyChatMutation.isPending;
  const canClearChat =
    Boolean(chat && messageCount > 0) && !pending && !hasActiveOrchestration;
  const historyQueryErrorMessage = rockyChatsQuery.error
    ? getErrorMessage(
        rockyChatsQuery.error,
        "이전 대화 목록을 불러오지 못했습니다."
      )
    : null;
  const historyDeleteErrorMessage = deleteHistoryChatMutation.error
    ? getErrorMessage(
        deleteHistoryChatMutation.error,
        "이전 대화를 삭제하지 못했습니다."
      )
    : null;
  const historyErrorMessage =
    historyDeleteErrorMessage ?? historyQueryErrorMessage;
  const deletingHistoryChatId = deleteHistoryChatMutation.isPending
    ? deleteHistoryChatMutation.variables ?? null
    : null;
  const canLoadHistory =
    !pending &&
    (previousChats.length > 0 ||
      rockyChatsQuery.isLoading ||
      Boolean(historyErrorMessage));
  const errorMessage =
    createChatMutation.error?.message ??
    sendMessageMutation.error?.message ??
    cancelRockyChatMutation.error?.message ??
    startAbilityGuideMutation.error?.message;

  useEffect(() => {
    if (refreshedChat) {
      setChat(refreshedChat);
    }
  }, [refreshedChat]);

  useEffect(() => {
    if (chat || suppressAutoSelect || !rockyChats || rockyChats.length === 0) {
      return;
    }

    const activeChat = rockyChats.find(chatHasActiveOrchestration);
    if (activeChat) {
      setChat(activeChat);
    }
  }, [chat, rockyChats, suppressAutoSelect]);

  useEffect(() => {
    const active = new Set(
      activeRunIdsKey ? activeRunIdsKey.split("\n").filter(Boolean) : []
    );

    for (const [runId, source] of runProgressSourcesRef.current) {
      if (!active.has(runId)) {
        source.close();
        runProgressSourcesRef.current.delete(runId);
      }
    }

    setRunProgressByRunId((current) => {
      let next = current;
      for (const runId of Object.keys(current)) {
        if (!active.has(runId)) {
          next = { ...next };
          delete next[runId];
        }
      }
      for (const runId of active) {
        if (!next[runId]) {
          next = { ...next, [runId]: "실행 연결 중" };
        }
      }
      return next;
    });

    for (const runId of active) {
      if (runProgressSourcesRef.current.has(runId)) {
        continue;
      }

      const dispatch = chat?.dispatches.find(
        (entry) => entry.orchestration?.runId === runId
      );
      const updateProgress = (label: string) => {
        setRunProgressByRunId((current) =>
          current[runId] === label ? current : { ...current, [runId]: label }
        );
      };
      const source = new RunEventsSource(runId, {
        onOpen: () => updateProgress("실행 연결 중"),
        onError: () => updateProgress("상태 동기화 중"),
        onEvent: (event) => {
          const label = rockyRunProgressLabelForEvent(event, {
            attachmentCount: dispatch?.attachmentIds.length ?? 0,
            skillId: dispatch?.skillId ?? null,
            status: dispatch?.orchestration?.status ?? null,
          });
          if (label) {
            updateProgress(label);
          }

          if (isTerminalRockyRunEvent(event)) {
            source.close();
            runProgressSourcesRef.current.delete(runId);
          }
        },
      });
      runProgressSourcesRef.current.set(runId, source);
    }
  }, [activeRunIdsKey, chat?.dispatches]);

  useEffect(() => {
    return () => {
      for (const source of runProgressSourcesRef.current.values()) {
        source.close();
      }
      runProgressSourcesRef.current.clear();
    };
  }, []);

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

  const sendRockyInput = async (inputMessage: string, inputFiles: File[]) => {
    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitInFlight(true);
    try {
      const attachments = await Promise.all(
        inputFiles.map(async (file) => ({
          name: file.name,
          contentType: file.type || null,
          size: file.size,
          contentBase64: await fileToBase64(file),
        }))
      );
      const input = {
        message: inputMessage.trim(),
        attachments,
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) {
      return;
    }

    await sendRockyInput(message, files);
  };

  const startTemplate = async (
    template: MdTemplateDefinition,
    userBrief: string
  ) => {
    if (pending || hasActiveOrchestration) {
      return;
    }

    await sendRockyInput(
      buildTemplateRunPrompt(template, {
        selectedFileNames: files.map((file) => file.name),
        userBrief,
      }),
      files
    );
    setTemplateExecutionTemplate(null);
  };

  const startAbilityGuide = async (ability: RockyAbilityCardRecord) => {
    if (pending || submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitInFlight(true);
    try {
      const nextChat = await startAbilityGuideMutation.mutateAsync(ability.id);

      setChat(nextChat);
      setMessage("");
      setFiles([]);
    } finally {
      submitInFlightRef.current = false;
      setSubmitInFlight(false);
    }
  };

  const stopActiveResponse = async () => {
    if (!chat?.id || !hasActiveOrchestration || cancelRockyChatMutation.isPending) {
      return;
    }

    try {
      const nextChat = await cancelRockyChatMutation.mutateAsync();
      setChat(nextChat);
      toast.success("요청을 중지했습니다.");
    } catch (error) {
      toast.error("요청을 중지하지 못했습니다.", {
        description: getErrorMessage(error, "잠시 후 다시 시도해 주세요."),
      });
    }
  };

  const clearConversation = async () => {
    if (!chat?.id || !canClearChat) {
      return;
    }

    setSuppressAutoSelect(true);
    setChat(null);
    setMessage("");
    setFiles([]);
    setTemplateExecutionTemplate(null);
    setPreviewPanelSource(null);
  };

  const loadPreviousChat = (selectedChat: RockyChatRecord) => {
    if (pending || selectedChat.id === chat?.id) {
      return;
    }

    setChat(selectedChat);
    setSuppressAutoSelect(false);
    setPreviewPanelSource(null);
    setTemplateExecutionTemplate(null);
    setMessage("");
    setFiles([]);
    setHistoryDialogOpen(false);
  };

  const deletePreviousChat = async (selectedChat: RockyChatRecord) => {
    if (pending) {
      return;
    }

    const confirmed = window.confirm(
      `"${selectedChat.title || "제목 없는 대화"}" 대화를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) {
      return;
    }

    await deleteHistoryChatMutation.mutateAsync(selectedChat.id);

    if (selectedChat.id === chat?.id) {
      setSuppressAutoSelect(true);
      setChat(null);
      setPreviewPanelSource(null);
      setTemplateExecutionTemplate(null);
      setMessage("");
      setFiles([]);
    }
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
              runProgressByRunId={runProgressByRunId}
              transcriptsBySessionId={transcriptsBySessionId}
            />
          ) : (
            <EmptyChatState
              abilities={abilities}
              abilitiesLoading={abilitiesQuery.isLoading}
              disabled={pending}
              onSelectAbility={(ability) => {
                void startAbilityGuide(ability);
              }}
              onSelectTemplate={(template) => {
                setTemplateExecutionTemplate(template);
              }}
              userTemplates={userTemplates}
            />
          )}
        </main>

        <ChatComposer
          canSend={canSend}
          canClearChat={canClearChat}
          canLoadHistory={canLoadHistory}
          canStop={canStop}
          chatStarted={Boolean(chat)}
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
          onOpenHistory={() => setHistoryDialogOpen(true)}
          onStop={() => {
            void stopActiveResponse();
          }}
          onMessageChange={setMessage}
          onSubmit={submit}
          stopPending={cancelRockyChatMutation.isPending}
        />
      </section>

      <TemplateExecutionDialog
        disabled={pending}
        files={files}
        onFileRemove={(file) =>
          setFiles((current) => current.filter((item) => item !== file))
        }
        onFilesChange={setFiles}
        onOpenChange={(open) => {
          if (!open) {
            setTemplateExecutionTemplate(null);
          }
        }}
        onStart={(template, userBrief) => {
          void startTemplate(template, userBrief);
        }}
        open={Boolean(templateExecutionTemplate)}
        template={templateExecutionTemplate}
      />

      <PreviousChatsDialog
        chats={previousChats}
        currentChatId={chat?.id ?? null}
        deletingChatId={deletingHistoryChatId}
        disabled={pending}
        errorMessage={historyErrorMessage}
        loading={rockyChatsQuery.isLoading}
        onDeleteChat={(selectedChat) => {
          void deletePreviousChat(selectedChat);
        }}
        onOpenChange={setHistoryDialogOpen}
        onSelectChat={loadPreviousChat}
        open={historyDialogOpen}
      />

      {previewPanelSource ? (
        <ArtifactPreviewPanel
          source={previewPanelSource}
          onClose={() => setPreviewPanelSource(null)}
        />
      ) : null}
    </div>
  );
}
