import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  Download,
  ExternalLink,
  FileInput,
  FileOutput,
  FileText,
  LayoutTemplate,
  Paperclip,
  PenLine,
  Presentation,
  Plus,
  RefreshCw,
  Send,
  Square,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { PptxArtifactPreview } from "@/domains/run/components/pptx-artifact-preview";
import { RunEventsSource } from "@/domains/run/lib/run-events-source";
import {
  useCancelRockyChatMutation,
  useCreateRockyChatMutation,
  useRockyChatQuery,
  useSendRockyMessageMutation,
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
import type { AgentWorkspaceFilePreviewRecord } from "@/shared/lib/agent-engine-client";
import { Textarea } from "@/shared/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { useMdTemplates } from "@/domains/template/hooks";
import { buildTemplateRunPrompt } from "@/domains/template/lib/md-template-definitions";
import { useAgentQuery } from "@/domains/agent/hooks";
import { useAgentEmoji } from "@/domains/agent/lib/agent-avatar-store";
import { useTaskAgentId } from "@/domains/agent/lib/task-agent-store";
import { AgentAvatar } from "@/domains/agent/components/agent-avatar";
import type {
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

type TemplatePanelFileRole = "input" | "output";

type TemplatePanelFile = {
  key: string;
  role: TemplatePanelFileRole;
  name: string;
  detail: string;
  contentType: string | null;
  size: number | null;
  agentId: string | null;
  workspacePath: string | null;
  artifact: AgentSessionArtifactManifestEntry | null;
  createdAt: string;
  expected: boolean;
};

type TemplateFilePanelContext = {
  title: string;
  outputFormatLabel: string;
  inputFiles: TemplatePanelFile[];
  outputFiles: TemplatePanelFile[];
  hasExplicitOutputFiles: boolean;
  active: boolean;
};

const TEMPLATE_RUN_MARKER = "[Rocky 템플릿 실행]";

type TemplateOutputKind = "powerpoint" | null;

const TEXT_WORKSPACE_PREVIEW_KINDS = new Set([
  "text",
  "code",
  "markdown",
  "html",
]);

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
  if (!value.startsWith(TEMPLATE_RUN_MARKER)) {
    return value;
  }

  const title = value.match(/^템플릿:\s*(.+)$/mu)?.[1]?.trim();
  return title ? `스킬 실행: ${title}` : "스킬 실행";
}

function parseMarkdownListSection(value: string, heading: string): string[] {
  const lines = value.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) {
    return [];
  }

  const items: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      break;
    }

    if (!trimmed.startsWith("- ")) {
      continue;
    }

    const item = trimmed.slice(2).trim();
    if (!item || item.includes("고정 output 파일 경로가 지정되지 않았습니다")) {
      continue;
    }

    items.push(item);
  }

  return items;
}

function parseTemplateRunMessage(value: string): {
  title: string;
  outputFiles: string[];
  outputFormatLabel: string;
} | null {
  if (!value.startsWith(TEMPLATE_RUN_MARKER)) {
    return null;
  }

  const title = value.match(/^템플릿:\s*(.+)$/mu)?.[1]?.trim();
  if (!title) {
    return null;
  }

  return {
    title,
    outputFiles: parseMarkdownListSection(value, "템플릿 output 파일:"),
    outputFormatLabel:
      value.match(/^최종 산출물:\s*(.+)$/mu)?.[1]?.trim() || "지정 없음",
  };
}

function normalizeTemplateFilePath(value: string): string {
  return value.trim().replace(/^\.\/+/, "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function templateFileName(value: string): string {
  const normalized = normalizeTemplateFilePath(value);
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

function templateFileKey(value: string): string {
  return normalizeTemplateFilePath(value).toLowerCase();
}

function latestCreatedAt(left: string, right: string): string {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();

  return (Number.isFinite(rightTime) ? rightTime : 0) >
    (Number.isFinite(leftTime) ? leftTime : 0)
    ? right
    : left;
}

function workspacePreviewPageHref(agentId: string, workspacePath: string): string {
  const params = new URLSearchParams();
  params.set("agentId", agentId);
  params.set("path", workspacePath);
  return `/workspace-preview?${params.toString()}`;
}

function inferTemplateOutputKind(value: string): TemplateOutputKind {
  const normalized = value.toLowerCase().replace(/\s+/g, "");

  if (
    normalized.includes("ppt") ||
    normalized.includes("powerpoint") ||
    normalized.includes("파워포인트") ||
    normalized.includes("프레젠테이션") ||
    normalized.includes("발표자료")
  ) {
    return "powerpoint";
  }

  return null;
}

function matchesTemplateOutputKind(
  artifact: AgentSessionArtifactManifestEntry,
  outputKind: TemplateOutputKind
): boolean {
  if (!outputKind) {
    return true;
  }

  if (outputKind === "powerpoint") {
    return isPowerPointArtifact(artifact);
  }

  return true;
}

function trimOutputPathCandidate(value: string): string {
  return normalizeTemplateFilePath(
    value
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[),.;:!?]+$/g, "")
  );
}

function isTemplateOutputPath(
  value: string,
  outputKind: TemplateOutputKind
): boolean {
  const normalized = normalizeTemplateFilePath(value);
  if (!normalized.startsWith("outputs/")) {
    return false;
  }

  const filename = templateFileName(normalized);
  if (!/\.[^/.]+$/u.test(filename)) {
    return false;
  }

  if (outputKind === "powerpoint") {
    return /\.pptx?$/iu.test(filename);
  }

  return true;
}

function extractTemplateOutputPathsFromText(
  value: string | null | undefined,
  outputKind: TemplateOutputKind
): string[] {
  if (!value) {
    return [];
  }

  const paths = new Set<string>();
  const addCandidate = (candidate: string) => {
    const normalized = trimOutputPathCandidate(candidate);
    if (isTemplateOutputPath(normalized, outputKind)) {
      paths.add(normalized);
    }
  };

  for (const match of value.matchAll(/`([^`]*outputs\/[^`]*)`/giu)) {
    addCandidate(match[1] ?? "");
  }

  for (const match of value.matchAll(
    /(?:^|[\s([{"'])((?:\.\/)?outputs\/[^\s`"'<>)\]}]+)/giu
  )) {
    addCandidate(match[1] ?? "");
  }

  return [...paths];
}

function rememberObservedOutputPath(
  outputPaths: Map<string, { path: string; createdAt: string }>,
  workspacePath: string,
  createdAt: string
): void {
  const key = templateFileKey(workspacePath);
  const current = outputPaths.get(key);
  outputPaths.set(key, {
    path: current?.path ?? workspacePath,
    createdAt: current ? latestCreatedAt(current.createdAt, createdAt) : createdAt,
  });
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
      previewPanelSource.previewHref ?? previewPanelSource.downloadHref,
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
          <h2 className="text-sm font-semibold text-foreground">저장한 스킬</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            카드를 누르면 Rocky가 필요한 값을 순서대로 묻습니다.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link to="/templates/new" />}>
          <Plus className="size-4" />
          새 스킬 만들기
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
            저장한 스킬이 없습니다.
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            스킬 메뉴에서 Rocky에게 업무 방식을 알려주면 홈 카드로 실행할 수 있습니다.
          </p>
          <Button className="mt-3" variant="outline" size="sm" render={<Link to="/templates/new" />}>
            <Plus className="size-4" />
            새 스킬 만들기
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

function EmptyChatState({
  disabled,
  onSelectTemplate,
  userTemplates,
}: {
  disabled: boolean;
  onSelectTemplate: (template: MdTemplateDefinition) => void;
  userTemplates: MdTemplateDefinition[];
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center pb-16 text-center">
      <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">
        어떤 작업을 시작할까요?
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">
        스킬을 고르거나 자료를 올려 Rocky에게 바로 요청하세요.
      </p>
      <TemplateCardGrid
        disabled={disabled}
        onSelectTemplate={onSelectTemplate}
        userTemplates={userTemplates}
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

function matchExplicitTemplateOutputPath(
  artifact: AgentSessionArtifactManifestEntry,
  workspacePath: string | null,
  outputPaths: string[]
): string | null {
  if (outputPaths.length === 0) {
    return null;
  }

  const artifactName = artifact.name.trim().toLowerCase();
  return (
    outputPaths.find((outputPath) => {
      const normalized = normalizeTemplateFilePath(outputPath);
      return (
        normalized === workspacePath ||
        templateFileName(normalized).toLowerCase() === artifactName
      );
    }) ?? null
  );
}

function outputArtifactKey(input: {
  artifact: AgentSessionArtifactManifestEntry;
  explicitOutputPath: string | null;
  workspacePath: string | null;
}): string {
  if (input.explicitOutputPath) {
    return `output:${templateFileKey(input.explicitOutputPath)}`;
  }

  return `output:${templateFileName(
    input.workspacePath ?? input.artifact.name
  ).toLowerCase()}`;
}

function sortTemplateFilesByFreshness(
  left: TemplatePanelFile,
  right: TemplatePanelFile
): number {
  if (left.expected !== right.expected) {
    return left.expected ? 1 : -1;
  }

  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();
  const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
  const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;

  if (safeLeftTime !== safeRightTime) {
    return safeRightTime - safeLeftTime;
  }

  return left.name.localeCompare(right.name, "ko");
}

function compareCreatedAtAscending(
  left: { createdAt: string },
  right: { createdAt: string }
): number {
  const leftTime = new Date(left.createdAt).getTime();
  const rightTime = new Date(right.createdAt).getTime();

  return (
    (Number.isFinite(leftTime) ? leftTime : 0) -
    (Number.isFinite(rightTime) ? rightTime : 0)
  );
}

function buildTemplateFilePanelContext(input: {
  chat: RockyChatRecord | null;
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
  userTemplates: MdTemplateDefinition[];
}): TemplateFilePanelContext | null {
  if (!input.chat) {
    return null;
  }

  let templateMessage: RockyMessageRecord | null = null;
  let parsedTemplate: ReturnType<typeof parseTemplateRunMessage> = null;

  for (const message of [...input.chat.messages].reverse()) {
    if (message.role !== "user") {
      continue;
    }

    const parsed = parseTemplateRunMessage(message.text);
    if (!parsed) {
      continue;
    }

    templateMessage = message;
    parsedTemplate = parsed;
    break;
  }

  if (!templateMessage || !parsedTemplate) {
    return null;
  }

  const template =
    input.userTemplates.find(
      (entry) =>
        entry.title === parsedTemplate.title &&
        entry.outputFormatLabel === parsedTemplate.outputFormatLabel
    ) ??
    input.userTemplates.find((entry) => entry.title === parsedTemplate.title) ??
    null;
  const templateDispatch =
    input.chat.dispatches.find((dispatch) => dispatch.messageId === templateMessage.id) ??
    null;
  const templateDispatchIndex = templateDispatch
    ? input.chat.dispatches.findIndex((dispatch) => dispatch.id === templateDispatch.id)
    : -1;
  const scopedDispatches =
    templateDispatchIndex >= 0
      ? input.chat.dispatches.slice(templateDispatchIndex)
      : input.chat.dispatches.filter(
          (dispatch) => dispatch.createdAt >= templateMessage.createdAt
        );
  scopedDispatches.sort(compareCreatedAtAscending);
  const agentId =
    templateDispatch?.orchestration?.agentId ??
    scopedDispatches.find((dispatch) => dispatch.orchestration?.agentId)
      ?.orchestration?.agentId ??
    null;
  const explicitInputPaths = (template?.inputFiles ?? [])
    .map(normalizeTemplateFilePath)
    .filter(Boolean);
  const explicitOutputPaths = [
    ...new Set(
      [...(template?.outputFiles ?? []), ...parsedTemplate.outputFiles]
        .map(normalizeTemplateFilePath)
        .filter(Boolean)
    ),
  ];
  const expectedOutputKind = inferTemplateOutputKind(
    template?.outputFormatLabel ?? parsedTemplate.outputFormatLabel
  );
  const observedOutputPathMap = new Map<string, { path: string; createdAt: string }>();
  for (const message of input.chat.messages) {
    if (message.createdAt < templateMessage.createdAt) {
      continue;
    }

    for (const outputPath of extractTemplateOutputPathsFromText(
      message.text,
      expectedOutputKind
    )) {
      rememberObservedOutputPath(
        observedOutputPathMap,
        outputPath,
        message.createdAt
      );
    }
  }
  for (const dispatch of scopedDispatches) {
    for (const outputPath of extractTemplateOutputPathsFromText(
      dispatch.orchestration?.output,
      expectedOutputKind
    )) {
      rememberObservedOutputPath(
        observedOutputPathMap,
        outputPath,
        dispatch.orchestration?.endedAt ??
          dispatch.orchestration?.updatedAt ??
          dispatch.createdAt
      );
    }
  }
  for (const dispatch of scopedDispatches) {
    const orchestration = dispatch.orchestration;
    if (!orchestration?.sessionId) {
      continue;
    }

    const transcriptMessage = findLatestAssistantMessage(
      input.transcriptsBySessionId[orchestration.sessionId],
      orchestration.runId
    );
    for (const outputPath of extractTemplateOutputPathsFromText(
      transcriptMessage?.content,
      expectedOutputKind
    )) {
      rememberObservedOutputPath(
        observedOutputPathMap,
        outputPath,
        transcriptMessage?.createdAt ?? dispatch.createdAt
      );
    }
  }
  const observedOutputPaths = [...observedOutputPathMap.values()];
  const outputPathsForMatching = [
    ...new Set([
      ...explicitOutputPaths,
      ...observedOutputPaths.map((entry) => entry.path),
    ]),
  ];
  const inputMap = new Map<string, TemplatePanelFile>();

  for (const inputPath of explicitInputPaths) {
    inputMap.set(`input:${inputPath}`, {
      key: `input:${inputPath}`,
      role: "input",
      name: templateFileName(inputPath),
      detail: inputPath,
      contentType: null,
      size: null,
      agentId,
      workspacePath: inputPath,
      artifact: null,
      createdAt: templateMessage.createdAt,
      expected: true,
    });
  }

  const inputAttachmentIds = new Set(
    templateDispatch?.attachmentIds.length
      ? templateDispatch.attachmentIds
      : templateMessage.attachmentIds
  );
  for (const attachment of input.chat.attachments) {
    if (!inputAttachmentIds.has(attachment.id)) {
      continue;
    }

    const workspacePath = attachment.workspacePath
      ? normalizeTemplateFilePath(attachment.workspacePath)
      : null;
    const key = `input:${workspacePath ?? attachment.id}`;
    inputMap.set(key, {
      key,
      role: "input",
      name: attachment.name,
      detail: workspacePath ?? "업로드 원본",
      contentType: attachment.contentType,
      size: attachment.size,
      agentId,
      workspacePath,
      artifact: null,
      createdAt: attachment.addedAt,
      expected: false,
    });
  }

  const outputMap = new Map<string, TemplatePanelFile>();
  for (const outputPath of explicitOutputPaths) {
    const key = `output:${templateFileKey(outputPath)}`;
    outputMap.set(key, {
      key,
      role: "output",
      name: templateFileName(outputPath),
      detail: outputPath,
      contentType: null,
      size: null,
      agentId,
      workspacePath: outputPath,
      artifact: null,
      createdAt: templateMessage.createdAt,
      expected: true,
    });
  }
  for (const observed of observedOutputPaths) {
    const key = `output:${templateFileKey(observed.path)}`;
    const existing = outputMap.get(key);
    outputMap.set(key, {
      key,
      role: "output",
      name: existing?.name ?? templateFileName(observed.path),
      detail: observed.path,
      contentType: existing?.contentType ?? null,
      size: existing?.size ?? null,
      agentId: existing?.agentId ?? agentId,
      workspacePath: observed.path,
      artifact: existing?.artifact ?? null,
      createdAt: existing
        ? latestCreatedAt(existing.createdAt, observed.createdAt)
        : observed.createdAt,
      expected: false,
    });
  }

  for (const dispatch of scopedDispatches) {
    const orchestration = dispatch.orchestration;
    if (!orchestration?.sessionId) {
      continue;
    }

    const transcriptMessage = findLatestAssistantMessage(
      input.transcriptsBySessionId[orchestration.sessionId],
      orchestration.runId
    );
    const artifacts = splitTranscriptArtifacts(transcriptMessage?.artifacts).visibleArtifacts;

    for (const artifact of artifacts) {
      const workspacePath = artifact.workspaceRelativePath
        ? normalizeTemplateFilePath(artifact.workspaceRelativePath)
        : null;
      const explicitOutputPath = matchExplicitTemplateOutputPath(
        artifact,
        workspacePath,
        outputPathsForMatching
      );

      if (outputPathsForMatching.length > 0 && !explicitOutputPath) {
        continue;
      }

      if (!matchesTemplateOutputKind(artifact, expectedOutputKind)) {
        continue;
      }

      const resolvedWorkspacePath = workspacePath ?? explicitOutputPath;
      const key = outputArtifactKey({
        artifact,
        explicitOutputPath,
        workspacePath: resolvedWorkspacePath,
      });
      const existing = outputMap.get(key);
      const createdAt = transcriptMessage?.createdAt ?? dispatch.createdAt;
      outputMap.set(key, {
        key,
        role: "output",
        name: existing?.name ?? artifact.name,
        detail: resolvedWorkspacePath ?? artifact.role,
        contentType: artifact.contentType,
        size: artifact.size,
        agentId: orchestration.agentId ?? agentId,
        workspacePath: resolvedWorkspacePath ?? existing?.workspacePath ?? null,
        artifact,
        createdAt: existing
          ? latestCreatedAt(existing.createdAt, createdAt)
          : createdAt,
        expected: false,
      });
    }
  }

  return {
    title: parsedTemplate.title,
    outputFormatLabel: parsedTemplate.outputFormatLabel,
    inputFiles: [...inputMap.values()],
    outputFiles: [...outputMap.values()].sort(sortTemplateFilesByFreshness),
    hasExplicitOutputFiles: explicitOutputPaths.length > 0,
    active: scopedDispatches.some((dispatch) => {
      const status = dispatch.orchestration?.status;
      return status === "running" || status === "planned";
    }),
  };
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

function ChatReplyAvatar({ chatId }: { chatId: string }) {
  const agentId = useTaskAgentId(chatId);
  const agentQuery = useAgentQuery(agentId ?? undefined);
  const { emoji } = useAgentEmoji(agentId ?? undefined);

  if (agentId && agentQuery.data) {
    return (
      <div className="mt-1 shrink-0">
        <AgentAvatar emoji={emoji} color={agentQuery.data.color} size="sm" />
      </div>
    );
  }

  return <RockyReplyMark />;
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
        <ChatReplyAvatar chatId={chat.id} />
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
      {isRocky ? <ChatReplyAvatar chatId={chat.id} /> : null}
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
  canStop,
  chatStarted,
  errorMessage,
  files,
  message,
  onFilesChange,
  onFileRemove,
  onClearChat,
  onStop,
  onMessageChange,
  onSubmit,
  stopPending,
}: {
  canSend: boolean;
  canClearChat: boolean;
  canStop: boolean;
  chatStarted: boolean;
  errorMessage: string | undefined;
  files: File[];
  message: string;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (file: File) => void;
  onClearChat: () => void;
  onStop: () => void;
  onMessageChange: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  stopPending: boolean;
}) {
  return (
    <footer className="shrink-0 bg-background px-3 pb-4 pt-2 md:px-6 md:pb-6">
      <div className="mx-auto mb-2 flex w-full max-w-4xl justify-end gap-2">
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
          <DialogTitle>스킬 실행 준비</DialogTitle>
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
                  aria-label="스킬 실행 자료 파일 선택"
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
            스킬 실행
            <ArrowRight className="size-4" />
          </Button>
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
  const previewOpenHref = source.previewHref ?? source.downloadHref;

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
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {panelLabel}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {source.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {source.detail}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={previewOpenHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
          >
            새 창
          </a>
          {source.nativeOpenPath ? (
            <button
              type="button"
              disabled={nativeOpenPending}
              onClick={openNativePowerPoint}
              className="inline-flex rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {nativeOpenLabel}
            </button>
          ) : null}
          <a
            href={source.downloadHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
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
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            HTML 미리보기를 불러오는 중입니다.
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
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

function EmbeddedArtifactPreviewPanel({
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
  const previewOpenHref = source.previewHref ?? source.downloadHref;

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
              : "미리보기를 불러오지 못했습니다.",
        });
      });

    return () => controller.abort();
  }, [source.downloadHref, source.kind]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {source.kind === "powerpoint" ? "PPT 뷰어" : "HTML 리포트"}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {source.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {source.detail}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="새 창에서 열기"
            title="새 창에서 열기"
            render={<a href={previewOpenHref} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="미리보기 닫기"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
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
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            미리보기를 불러오는 중입니다.
          </div>
        ) : state.kind === "error" ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            미리보기를 불러오지 못했습니다. {state.message}
          </div>
        ) : (
          <iframe
            title={`${source.name} 미리보기`}
            srcDoc={state.html}
            sandbox=""
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}

function templatePanelRoleLabel(role: TemplatePanelFileRole): string {
  return role === "input" ? "Input" : "Output";
}

function TemplateFileRow({
  file,
  selected,
  onSelect,
}: {
  file: TemplatePanelFile;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = file.role === "input" ? FileInput : FileOutput;
  const tone =
    file.role === "input"
      ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700"
      : "border-sky-500/25 bg-sky-500/8 text-sky-700";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border px-3 py-2.5 text-left transition",
        selected
          ? "border-primary/45 bg-primary/5 shadow-sm"
          : "border-border bg-background hover:bg-secondary/60"
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border",
            tone
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {file.name}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
            {file.detail}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <span className="rounded-md bg-muted px-1.5 py-0.5">
              {templatePanelRoleLabel(file.role)}
            </span>
            {file.expected ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5">대기</span>
            ) : null}
            {typeof file.size === "number" ? <span>{formatFileSize(file.size)}</span> : null}
          </span>
        </span>
      </div>
    </button>
  );
}

function TemplateFileSection({
  emptyText,
  files,
  onSelect,
  selectedKey,
  title,
}: {
  emptyText: string;
  files: TemplatePanelFile[];
  onSelect: (file: TemplatePanelFile) => void;
  selectedKey: string | null;
  title: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {title}
        </h3>
        <span className="text-[11px] text-muted-foreground">{files.length}</span>
      </div>
      {files.length > 0 ? (
        <div className="space-y-2">
          {files.map((file) => (
            <TemplateFileRow
              key={file.key}
              file={file}
              selected={selectedKey === file.key}
              onSelect={() => onSelect(file)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </section>
  );
}

function WorkspacePreviewBody({
  record,
}: {
  record: AgentWorkspaceFilePreviewRecord;
}) {
  const inlinePreviewHref = record.inlinePreviewUrl
    ? agentEngineClient.resolveApiPath(record.inlinePreviewUrl)
    : null;

  if (
    TEXT_WORKSPACE_PREVIEW_KINDS.has(record.previewKind) &&
    typeof record.text === "string"
  ) {
    return (
      <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-foreground">
        {record.text || "빈 파일입니다."}
      </pre>
    );
  }

  if (record.previewKind === "image" && inlinePreviewHref) {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/40 p-3">
        <img
          src={inlinePreviewHref}
          alt={record.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (record.previewKind === "audio" && inlinePreviewHref) {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/40 p-4">
        <audio controls src={inlinePreviewHref} className="w-full" />
      </div>
    );
  }

  if (record.previewKind === "video" && inlinePreviewHref) {
    return (
      <video
        controls
        src={inlinePreviewHref}
        className="h-full w-full bg-black object-contain"
      />
    );
  }

  if (isPowerPointFile(record.name, record.contentType)) {
    return (
      <div className="h-full bg-muted/40 p-3">
        <PptxArtifactPreview
          contentType={record.contentType}
          downloadHref={agentEngineClient.resolveApiPath(record.downloadUrl)}
          name={record.name}
          previewHref={null}
        />
      </div>
    );
  }

  if (inlinePreviewHref) {
    return (
      <iframe
        title={`${record.name} 미리보기`}
        src={inlinePreviewHref}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      이 형식은 바로 미리보기보다 다운로드로 확인하는 파일입니다.
    </div>
  );
}

function ArtifactFallbackPreview({
  artifact,
}: {
  artifact: AgentSessionArtifactManifestEntry;
}) {
  const previewHref = artifact.previewUrl
    ? agentEngineClient.resolveApiPath(artifact.previewUrl)
    : null;
  const downloadHref = agentEngineClient.resolveApiPath(artifact.downloadUrl);

  if (artifact.presentation === "image" && previewHref) {
    return (
      <div className="flex min-h-full items-center justify-center bg-muted/40 p-3">
        <img
          src={previewHref}
          alt={artifact.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (isPowerPointArtifact(artifact)) {
    return (
      <div className="h-full bg-muted/40 p-3">
        <PptxArtifactPreview
          contentType={artifact.contentType}
          downloadHref={downloadHref}
          name={artifact.name}
          previewHref={null}
        />
      </div>
    );
  }

  if (previewHref) {
    return (
      <iframe
        title={`${artifact.name} 미리보기`}
        src={previewHref}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
      이 output은 다운로드로 확인할 수 있습니다.
    </div>
  );
}

function TemplateSelectedFilePreview({
  active,
  file,
  refreshKey,
}: {
  active: boolean;
  file: TemplatePanelFile | null;
  refreshKey: string;
}) {
  const workspacePreviewQuery = useQuery({
    queryKey: [
      "rocky-template-file-preview",
      file?.agentId ?? "unknown",
      file?.workspacePath ?? "",
      refreshKey,
    ],
    queryFn: () =>
      agentEngineClient.getAgentWorkspaceFilePreview(
        file!.agentId!,
        file!.workspacePath!
      ),
    enabled: Boolean(file?.agentId && file.workspacePath),
    refetchInterval: active ? LIVE_TRANSCRIPT_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: active,
  });

  if (!file) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        확인할 파일이 없습니다.
      </div>
    );
  }

  const downloadHref =
    file.agentId && file.workspacePath
      ? agentEngineClient.agentWorkspaceFileDownloadUrl(file.agentId, file.workspacePath)
      : file.artifact
        ? agentEngineClient.resolveApiPath(file.artifact.downloadUrl)
        : null;
  const openHref =
    file.agentId && file.workspacePath
      ? workspacePreviewPageHref(file.agentId, file.workspacePath)
      : file.artifact?.previewUrl
        ? agentEngineClient.resolveApiPath(file.artifact.previewUrl)
        : downloadHref;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
            {file.role === "input" ? (
              <FileInput className="size-3.5" />
            ) : (
              <FileOutput className="size-3.5" />
            )}
            {templatePanelRoleLabel(file.role)}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {file.name}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {file.detail}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {file.role === "output" && file.agentId && file.workspacePath ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="파일 새로고침"
              title="파일 새로고침"
              onClick={() => {
                void workspacePreviewQuery.refetch();
              }}
            >
              <RefreshCw className="size-4" />
            </Button>
          ) : null}
          {openHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="새 창에서 열기"
              title="새 창에서 열기"
              render={<a href={openHref} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink className="size-4" />
            </Button>
          ) : null}
          {downloadHref ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="다운로드"
              title="다운로드"
              render={<a href={downloadHref} target="_blank" rel="noreferrer" />}
            >
              <Download className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
        {workspacePreviewQuery.isLoading ? (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            파일을 불러오는 중입니다.
          </div>
        ) : workspacePreviewQuery.isError ? (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {file.expected ? "아직 생성되지 않았습니다." : "파일 내용을 불러오지 못했습니다."}
          </div>
        ) : workspacePreviewQuery.data ? (
          <WorkspacePreviewBody record={workspacePreviewQuery.data} />
        ) : file.artifact ? (
          <ArtifactFallbackPreview artifact={file.artifact} />
        ) : (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            파일 경로가 준비되지 않았습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateFilePanel({
  context,
  externalPreviewSource,
  onClearExternalPreview,
  refreshKey,
}: {
  context: TemplateFilePanelContext;
  externalPreviewSource: RockyPreviewPanelSource | null;
  onClearExternalPreview: () => void;
  refreshKey: string;
}) {
  const allFiles = [...context.outputFiles, ...context.inputFiles];
  const defaultSelectedKey =
    context.outputFiles[0]?.key ?? context.inputFiles[0]?.key ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultSelectedKey);
  const fileKeySignature = allFiles.map((file) => file.key).join("\n");
  const selectedFile =
    allFiles.find((file) => file.key === selectedKey) ??
    allFiles.find((file) => file.key === defaultSelectedKey) ??
    null;

  useEffect(() => {
    if (!defaultSelectedKey) {
      setSelectedKey(null);
      return;
    }

    setSelectedKey((current) =>
      current && allFiles.some((file) => file.key === current)
        ? current
        : defaultSelectedKey
    );
  }, [defaultSelectedKey, fileKeySignature]);

  return (
    <aside className="flex h-[55vh] min-h-[24rem] shrink-0 flex-col border-t border-border bg-card shadow-sm lg:h-auto lg:min-h-0 lg:w-[min(42vw,42rem)] lg:border-l lg:border-t-0 xl:w-[40rem]">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
              <LayoutTemplate className="size-3.5" />
              스킬 파일
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground">
              {context.title}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {context.outputFormatLabel}
            </div>
          </div>
          {context.active ? (
            <Badge variant="secondary" className="shrink-0">
              진행 중
            </Badge>
          ) : null}
        </div>
      </header>

      {externalPreviewSource ? (
        <EmbeddedArtifactPreviewPanel
          source={externalPreviewSource}
          onClose={onClearExternalPreview}
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-0 lg:grid-rows-[minmax(10rem,0.7fr)_minmax(22rem,1.3fr)]">
          <div className="custom-scrollbar min-h-0 space-y-5 overflow-y-auto border-b border-border px-4 py-4">
            <TemplateFileSection
              title="Output"
              files={context.outputFiles}
              selectedKey={selectedFile?.key ?? selectedKey}
              emptyText={
                context.hasExplicitOutputFiles
                  ? "지정된 output 파일이 아직 생성되지 않았습니다."
                  : "아직 생성된 output 파일이 없습니다."
              }
              onSelect={(file) => setSelectedKey(file.key)}
            />
            <TemplateFileSection
              title="Input 원본"
              files={context.inputFiles}
              selectedKey={selectedFile?.key ?? selectedKey}
              emptyText="연결된 input 파일이 없습니다."
              onSelect={(file) => setSelectedKey(file.key)}
            />
          </div>
          <div className="min-h-0 overflow-hidden p-4">
            <TemplateSelectedFilePreview
              active={context.active}
              file={selectedFile}
              refreshKey={refreshKey}
            />
          </div>
        </div>
      )}
    </aside>
  );
}

type RockyWorkspaceMode = "home" | "task-detail";

function RockyWorkspacePage({ mode }: { mode: RockyWorkspaceMode }) {
  const navigate = useNavigate();
  const params = useParams<{ taskId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTaskDetail = mode === "task-detail";
  const routeTaskId = isTaskDetail ? params.taskId ?? null : null;
  const [chat, setChat] = useState<RockyChatRecord | null>(null);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const [templateExecutionTemplate, setTemplateExecutionTemplate] =
    useState<MdTemplateDefinition | null>(null);
  const [previewPanelSource, setPreviewPanelSource] =
    useState<RockyPreviewPanelSource | null>(null);
  const [runProgressByRunId, setRunProgressByRunId] = useState<Record<string, string>>(
    {}
  );
  const submitInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const runProgressSourcesRef = useRef<Map<string, RunEventsSource>>(new Map());
  const { userTemplates } = useMdTemplates();
  const createChatMutation = useCreateRockyChatMutation();
  const sendMessageMutation = useSendRockyMessageMutation(chat?.id ?? null);
  const cancelRockyChatMutation = useCancelRockyChatMutation(chat?.id ?? null);
  const rockyChatQuery = useRockyChatQuery(
    isTaskDetail ? routeTaskId : chat?.id ?? null
  );
  const { data: refreshedChat, refetch: refetchRockyChat } = rockyChatQuery;
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
  const templateFilePanelContext = useMemo(
    () =>
      buildTemplateFilePanelContext({
        chat,
        transcriptsBySessionId,
        userTemplates,
      }),
    [chat, transcriptRefreshMarker, userTemplates]
  );
  const templateFileRefreshKey = `${chat?.updatedAt ?? "no-chat"}:${transcriptRefreshMarker}`;

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
    sendMessageMutation.isPending;
  const pending = mutationPending || cancelRockyChatMutation.isPending;
  const canSend =
    (message.trim().length > 0 || files.length > 0) &&
    !mutationPending &&
    !cancelRockyChatMutation.isPending &&
    !hasActiveOrchestration &&
    (!isTaskDetail || Boolean(chat));
  const canStop =
    Boolean(chat?.id) &&
    hasActiveOrchestration &&
    !cancelRockyChatMutation.isPending;
  const canClearChat =
    isTaskDetail && Boolean(chat && messageCount > 0) && !pending && !hasActiveOrchestration;
  const errorMessage =
    createChatMutation.error?.message ??
    sendMessageMutation.error?.message ??
    cancelRockyChatMutation.error?.message;

  useEffect(() => {
    if (refreshedChat) {
      setChat(refreshedChat);
    }
  }, [refreshedChat]);

  useEffect(() => {
    if (!isTaskDetail) {
      setChat(null);
      setPreviewPanelSource(null);
      return;
    }

    setChat((current) => (current?.id === routeTaskId ? current : null));
    setPreviewPanelSource(null);
    setTemplateExecutionTemplate(null);
  }, [isTaskDetail, routeTaskId]);

  useEffect(() => {
    if (isTaskDetail) {
      return;
    }

    const requestedTemplateId = searchParams.get("templateId");
    if (!requestedTemplateId) {
      return;
    }

    const template = userTemplates.find((entry) => entry.id === requestedTemplateId);
    if (template) {
      setTemplateExecutionTemplate(template);
      setSearchParams({}, { replace: true });
    }
  }, [isTaskDetail, searchParams, setSearchParams, userTemplates]);

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
      if (!isTaskDetail) {
        navigate(`/tasks/${encodeURIComponent(nextChat.id)}`);
      }
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

    setChat(null);
    setMessage("");
    setFiles([]);
    setTemplateExecutionTemplate(null);
    setPreviewPanelSource(null);
    navigate("/");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-8">
          {isTaskDetail && !chat ? (
            <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center text-center">
              <div className="text-sm font-medium text-foreground">
                {rockyChatQuery.isError
                  ? "작업을 불러오지 못했습니다."
                  : "작업을 불러오는 중입니다."}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {rockyChatQuery.isError
                  ? getErrorMessage(rockyChatQuery.error, "잠시 후 다시 시도해 주세요.")
                  : "Rocky 작업 대화와 진행 상태를 준비하고 있습니다."}
              </p>
              {rockyChatQuery.isError ? (
                <Button className="mt-4" variant="outline" render={<Link to="/tasks" />}>
                  작업 목록으로
                </Button>
              ) : null}
            </div>
          ) : chat && messageCount > 0 ? (
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
              disabled={pending}
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
          canStop={canStop}
          chatStarted={isTaskDetail && Boolean(chat)}
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

      {templateFilePanelContext ? (
        <TemplateFilePanel
          context={templateFilePanelContext}
          externalPreviewSource={previewPanelSource}
          onClearExternalPreview={() => setPreviewPanelSource(null)}
          refreshKey={templateFileRefreshKey}
        />
      ) : previewPanelSource ? (
        <ArtifactPreviewPanel
          source={previewPanelSource}
          onClose={() => setPreviewPanelSource(null)}
        />
      ) : null}
    </div>
  );
}

export { HomeDashboard as HomePage } from "./home-dashboard";

export function RockyTaskDetailPage() {
  return <RockyWorkspacePage mode="task-detail" />;
}
