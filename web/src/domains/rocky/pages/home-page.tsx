import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowLeft,
  AtSign,
  BarChart3,
  Copy,
  Download,
  ExternalLink,
  FileInput,
  FileOutput,
  FileText,
  FolderOpen,
  LayoutTemplate,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Presentation,
  Plus,
  RefreshCw,
  Search,
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
import {
  formatRockyTaskDateTime,
  formatRockyTaskDuration,
  getRockyTaskEndedAt,
  getRockyTaskLastActivityAt,
  getRockyTaskStartedAt,
} from "@/domains/rocky/lib/rocky-task-model";
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
import { MarkdownDocumentPreview } from "@/shared/components/markdown-document-preview";
import { XlsxWorkbookPreview } from "@/shared/components/xlsx-workbook-preview";
import { WorkspaceAwareMarkdownLink } from "@/shared/components/workspace-aware-markdown-link";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import type { WorkspacePreviewPathKind } from "@/shared/lib/workspace-link-target";
import { agentEngineClient } from "@/shared/lib/api-client";
import type {
  AgentWorkspaceDirectoryRecord,
  AgentWorkspaceEntryRecord,
  AgentWorkspaceFilePreviewRecord,
  AgentWorkspaceSearchRecord,
} from "@/shared/lib/agent-engine-client";
import { Textarea } from "@/shared/ui/textarea";
import { Input } from "@/shared/ui/input";
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
const TEMPLATE_FILE_PANEL_DEFAULT_WIDTH = 640;
const TEMPLATE_FILE_PANEL_MIN_WIDTH = 360;
const TEMPLATE_FILE_PANEL_MAX_WIDTH = 920;
const TEMPLATE_FILE_PANEL_MAIN_MIN_WIDTH = 360;
const TEMPLATE_FILE_PANEL_WIDTH_STEP = 24;
const TEMPLATE_FILE_LIST_DEFAULT_HEIGHT = 240;
const TEMPLATE_FILE_LIST_MIN_HEIGHT = 144;
const TEMPLATE_FILE_PREVIEW_MIN_HEIGHT = 240;
const TEMPLATE_FILE_SPLIT_STEP = 24;
const TEMPLATE_OUTPUTS_ROOT = "outputs";

type RockyPreviewPanelSource = {
  contentType: string;
  detail: string;
  downloadHref: string;
  kind:
    | "html"
    | "powerpoint"
    | "pdf"
    | "image"
    | "markdown"
    | "text"
    | "spreadsheet";
  name: string;
  folderOpenPath: string | null;
  nativeOpenPath: string | null;
  previewHref?: string | null;
};

type PreviewMode = "viewer" | "original";

type TemplatePanelFileRole = "input" | "output";
type TemplatePanelFileKind = "file" | "directory";

type TemplatePanelFile = {
  key: string;
  kind?: TemplatePanelFileKind;
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

type FileMentionRange = {
  start: number;
  end: number;
};

type TemplateFilePanelContext = {
  title: string;
  outputFormatLabel: string;
  inputFiles: TemplatePanelFile[];
  outputFiles: TemplatePanelFile[];
  hasExplicitOutputFiles: boolean;
  active: boolean;
};

type TemplateFilePanelSelectionError = {
  title: string;
  detail: string;
  message: string;
};

type TemplateFilePanelSelectionRequest = {
  id: number;
  selectedKey: string | null;
  error: TemplateFilePanelSelectionError | null;
};

type DeletedWorkspaceTarget = {
  agentId: string;
  path: string;
};

type RockyConversationFileTarget =
  | {
      kind: "artifact";
      artifact: AgentSessionArtifactManifestEntry;
    }
  | {
      kind: "attachment";
      attachment: RockyAttachmentRecord;
    }
  | {
      kind: "workspace-path";
      agentId: string;
      path: string;
      pathKind: WorkspacePreviewPathKind;
    };

function clampNumber(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function maxTemplateFilePanelWidth(): number {
  if (typeof window === "undefined") {
    return TEMPLATE_FILE_PANEL_MAX_WIDTH;
  }

  return Math.max(
    TEMPLATE_FILE_PANEL_MIN_WIDTH,
    Math.min(
      TEMPLATE_FILE_PANEL_MAX_WIDTH,
      window.innerWidth - TEMPLATE_FILE_PANEL_MAIN_MIN_WIDTH
    )
  );
}

function clampTemplateFilePanelWidth(value: number): number {
  return clampNumber(
    value,
    TEMPLATE_FILE_PANEL_MIN_WIDTH,
    maxTemplateFilePanelWidth()
  );
}

function templateFileListHeightBounds(
  container: HTMLDivElement | null
): { min: number; max: number } {
  const containerHeight = container?.getBoundingClientRect().height ?? 0;
  const availableMax =
    containerHeight > 0
      ? containerHeight - TEMPLATE_FILE_PREVIEW_MIN_HEIGHT
      : TEMPLATE_FILE_LIST_DEFAULT_HEIGHT * 2;
  const max = Math.max(TEMPLATE_FILE_LIST_MIN_HEIGHT, availableMax);

  return {
    min: Math.min(TEMPLATE_FILE_LIST_MIN_HEIGHT, max),
    max,
  };
}

function clampTemplateFileListHeight(
  value: number,
  container: HTMLDivElement | null
): number {
  const bounds = templateFileListHeightBounds(container);
  return clampNumber(value, bounds.min, bounds.max);
}

const TEMPLATE_RUN_MARKER = "[Rocky 템플릿 실행]";

type TemplateOutputKind = "powerpoint" | null;

const TEXT_WORKSPACE_PREVIEW_KINDS = new Set([
  "text",
  "code",
  "markdown",
  "html",
]);
const IGNORED_PANEL_FILE_NAMES = new Set([".DS_Store"]);
const SAFE_WORKSPACE_SKILL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

type SkillInputSource = {
  agentId: string;
  skillId: string;
  skillDisplayName: string;
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

function isXlsxFile(name: string, contentType: string): boolean {
  const normalizedType = baseContentType(contentType);
  const normalizedName = name.toLowerCase();

  return (
    normalizedType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    normalizedName.endsWith(".xlsx")
  );
}

function isPowerPointArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  return isPowerPointFile(artifact.name, artifact.contentType);
}

function isPdfArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  const type = baseContentType(artifact.contentType);
  return type === "application/pdf" || artifact.name.toLowerCase().endsWith(".pdf");
}

function isImageArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  const type = baseContentType(artifact.contentType);
  if (type.startsWith("image/")) return true;
  const name = artifact.name.toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name);
}

function isMarkdownArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  const type = baseContentType(artifact.contentType);
  if (type === "text/markdown" || type === "text/x-markdown") return true;
  return /\.(md|markdown)$/i.test(artifact.name);
}

function isPlainTextArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  const type = baseContentType(artifact.contentType);
  if (type.startsWith("text/")) return true;
  return /\.(txt|csv|tsv|json|ya?ml|log)$/i.test(artifact.name);
}

function buildArtifactPreviewPanelSource(
  artifact: AgentSessionArtifactManifestEntry
): RockyPreviewPanelSource | null {
  const downloadHref = agentEngineClient.resolveApiPath(artifact.downloadUrl);
  const detail = `${artifact.role} · ${artifact.contentType}`;
  const folderOpenPath = `${artifact.downloadUrl}/open-folder-native`;

  if (isHtmlArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "html",
      name: artifact.name,
      nativeOpenPath: null,
    };
  }

  if (isPowerPointArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "powerpoint",
      name: artifact.name,
      nativeOpenPath: `${artifact.downloadUrl}/open-native`,
      previewHref: artifact.previewUrl
        ? agentEngineClient.resolveApiPath(artifact.previewUrl)
        : null,
    };
  }

  if (isPdfArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "pdf",
      name: artifact.name,
      nativeOpenPath: null,
      previewHref: artifact.previewUrl
        ? agentEngineClient.resolveApiPath(artifact.previewUrl)
        : null,
    };
  }

  if (isImageArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "image",
      name: artifact.name,
      nativeOpenPath: null,
      previewHref: artifact.previewUrl
        ? agentEngineClient.resolveApiPath(artifact.previewUrl)
        : null,
    };
  }

  if (isMarkdownArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "markdown",
      name: artifact.name,
      nativeOpenPath: null,
    };
  }

  if (isXlsxFile(artifact.name, artifact.contentType)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "spreadsheet",
      name: artifact.name,
      nativeOpenPath: null,
      previewHref: null,
    };
  }

  if (isPlainTextArtifact(artifact)) {
    return {
      contentType: artifact.contentType,
      detail,
      downloadHref,
      folderOpenPath,
      kind: "text",
      name: artifact.name,
      nativeOpenPath: null,
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

function isIgnoredPanelFileName(value: string | null | undefined): boolean {
  return Boolean(value && IGNORED_PANEL_FILE_NAMES.has(value));
}

function isIgnoredPanelWorkspacePath(value: string | null | undefined): boolean {
  return isIgnoredPanelFileName(value ? templateFileName(value) : null);
}

function templateFileKey(value: string): string {
  return normalizeTemplateFilePath(value).toLowerCase();
}

function templatePanelFileKind(file: TemplatePanelFile | null | undefined): TemplatePanelFileKind {
  return file?.kind ?? "file";
}

function templateFilePathParts(value: string): string[] {
  return normalizeTemplateFilePath(value).split("/").filter(Boolean);
}

function templatePanelFileFromDirectoryPath(input: {
  agentId: string;
  role: TemplatePanelFileRole;
  path: string;
  createdAt?: string;
  expected?: boolean;
}): TemplatePanelFile {
  const normalizedPath = normalizeTemplateFilePath(input.path);

  return {
    key: `browse:${input.role}:${input.agentId}:${templateFileKey(normalizedPath || ".")}`,
    kind: "directory",
    role: input.role,
    name: normalizedPath ? templateFileName(normalizedPath) : ".",
    detail: normalizedPath || ".",
    contentType: null,
    size: null,
    agentId: input.agentId,
    workspacePath: normalizedPath || ".",
    artifact: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    expected: input.expected ?? false,
  };
}

function workspacePathContains(parentPath: string, childPath: string): boolean {
  const parent = normalizeTemplateFilePath(parentPath);
  const child = normalizeTemplateFilePath(childPath);

  if (!parent || parent === ".") {
    return child === parent;
  }

  return child === parent || child.startsWith(`${parent}/`);
}

function isTemplateFileDeleted(
  file: TemplatePanelFile,
  deletedTargets: DeletedWorkspaceTarget[]
): boolean {
  if (!file.agentId || !file.workspacePath) {
    return false;
  }

  return deletedTargets.some(
    (target) =>
      target.agentId === file.agentId &&
      workspacePathContains(target.path, file.workspacePath!)
  );
}

function canDeleteTemplatePanelFile(file: TemplatePanelFile | null | undefined): boolean {
  if (!file?.agentId || !file.workspacePath || file.expected) {
    return false;
  }

  const normalizedPath = normalizeTemplateFilePath(file.workspacePath);
  return Boolean(normalizedPath && normalizedPath !== ".");
}

function templatePathKind(value: string): TemplatePanelFileKind {
  const normalized = normalizeTemplateFilePath(value);
  const leaf = templateFileName(normalized);
  return /\.[^/.]+$/u.test(leaf) ? "file" : "directory";
}

function panelFileDisplayDetail(file: TemplatePanelFile): string {
  if (file.role === "input" && file.detail.startsWith("스킬: ")) {
    return `스킬 포함 입력 · ${file.detail.slice("스킬: ".length)}`;
  }

  return file.detail;
}

function panelFileMatchesSearch(file: TemplatePanelFile, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    file.name,
    file.detail,
    file.workspacePath ?? "",
    templatePanelRoleLabel(file.role),
    templatePanelFileKind(file) === "directory" ? "folder directory 폴더" : "file 파일",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function templatePanelFileIdentity(file: TemplatePanelFile): string {
  if (file.agentId && file.workspacePath) {
    return [
      file.role,
      file.agentId,
      templatePanelFileKind(file),
      templateFileKey(file.workspacePath),
    ].join(":");
  }

  return file.key;
}

function mergeTemplatePanelFile(
  existing: TemplatePanelFile,
  incoming: TemplatePanelFile
): TemplatePanelFile {
  return {
    ...incoming,
    key: existing.key,
    artifact: incoming.artifact ?? existing.artifact,
    createdAt: latestCreatedAt(existing.createdAt, incoming.createdAt),
    expected: existing.expected && incoming.expected,
  };
}

function mergeTemplatePanelFiles(
  ...fileGroups: TemplatePanelFile[][]
): TemplatePanelFile[] {
  const filesByIdentity = new Map<string, TemplatePanelFile>();

  for (const file of fileGroups.flat()) {
    const identity = templatePanelFileIdentity(file);
    const existing = filesByIdentity.get(identity);
    filesByIdentity.set(
      identity,
      existing ? mergeTemplatePanelFile(existing, file) : file
    );
  }

  return [...filesByIdentity.values()].sort(sortTemplateFilesByFreshness);
}

function templatePanelFileFromWorkspaceEntry(input: {
  entry: AgentWorkspaceEntryRecord;
  role: TemplatePanelFileRole;
  agentId: string;
}): TemplatePanelFile {
  return {
    key: `browse:${input.role}:${input.agentId}:${templateFileKey(input.entry.path || ".")}`,
    kind: input.entry.kind,
    role: input.role,
    name: input.entry.name || ".",
    detail: input.entry.path || ".",
    contentType: input.entry.contentType,
    size: input.entry.size,
    agentId: input.agentId,
    workspacePath: input.entry.path || ".",
    artifact: null,
    createdAt: input.entry.updatedAt,
    expected: false,
  };
}

function templatePanelFilesFromWorkspaceEntries(input: {
  entries: AgentWorkspaceEntryRecord[];
  role: TemplatePanelFileRole;
  agentId: string;
}): TemplatePanelFile[] {
  return input.entries
    .filter((entry) => !isIgnoredPanelFileName(entry.name))
    .map((entry) =>
      templatePanelFileFromWorkspaceEntry({
        entry,
        role: input.role,
        agentId: input.agentId,
      })
    );
}

function collapseOutputFilesToOutputsRootChildren(
  files: TemplatePanelFile[]
): TemplatePanelFile[] {
  const outputChildren = new Map<string, TemplatePanelFile>();

  for (const file of files) {
    const workspacePath = file.workspacePath ?? file.detail;
    const parts = templateFilePathParts(workspacePath);

    if (parts[0] !== TEMPLATE_OUTPUTS_ROOT || parts.length <= 2) {
      outputChildren.set(templatePanelFileIdentity(file), file);
      continue;
    }

    if (!file.agentId) {
      outputChildren.set(templatePanelFileIdentity(file), file);
      continue;
    }

    const directChildPath = `${TEMPLATE_OUTPUTS_ROOT}/${parts[1]}`;
    const directChild = templatePanelFileFromDirectoryPath({
      agentId: file.agentId,
      role: file.role,
      path: directChildPath,
      createdAt: file.createdAt,
      expected: file.expected,
    });
    const identity = templatePanelFileIdentity(directChild);
    const existing = outputChildren.get(identity);
    outputChildren.set(
      identity,
      existing ? mergeTemplatePanelFile(existing, directChild) : directChild
    );
  }

  return [...outputChildren.values()].sort(sortTemplateFilesByFreshness);
}

function hasRealOutputFileWithSameName(
  expectedFile: TemplatePanelFile,
  files: TemplatePanelFile[]
): boolean {
  if (!expectedFile.expected || templatePanelFileKind(expectedFile) !== "file") {
    return false;
  }

  const expectedPath = normalizeTemplateFilePath(expectedFile.workspacePath ?? "");
  const expectedName = expectedFile.name.trim().toLowerCase();
  if (!expectedPath || !expectedName) {
    return false;
  }

  return files.some((file) => {
    if (
      file === expectedFile ||
      file.expected ||
      file.role !== expectedFile.role ||
      templatePanelFileKind(file) !== "file" ||
      file.name.trim().toLowerCase() !== expectedName
    ) {
      return false;
    }

    if (expectedFile.agentId && file.agentId && expectedFile.agentId !== file.agentId) {
      return false;
    }

    return !templateFilePathEquals(file.workspacePath, expectedPath);
  });
}

function removeExpectedOutputFilesResolvedElsewhere(
  files: TemplatePanelFile[]
): TemplatePanelFile[] {
  return files.filter((file) => !hasRealOutputFileWithSameName(file, files));
}

function isContextFileShadowedByWorkspaceSearch(
  file: TemplatePanelFile,
  workspaceFiles: TemplatePanelFile[]
): boolean {
  if (file.expected || templatePanelFileKind(file) !== "file") {
    return false;
  }

  const fileName = file.name.trim().toLocaleLowerCase();
  if (!fileName) {
    return false;
  }

  return workspaceFiles.some((workspaceFile) => {
    if (
      workspaceFile.expected ||
      workspaceFile.role !== file.role ||
      templatePanelFileKind(workspaceFile) !== "file" ||
      workspaceFile.name.trim().toLocaleLowerCase() !== fileName
    ) {
      return false;
    }

    if (
      file.agentId &&
      workspaceFile.agentId &&
      file.agentId !== workspaceFile.agentId
    ) {
      return false;
    }

    return !templateFilePathEquals(workspaceFile.workspacePath, file.workspacePath);
  });
}

function removeContextFilesShadowedByWorkspaceSearch(
  contextFiles: TemplatePanelFile[],
  workspaceFiles: TemplatePanelFile[]
): TemplatePanelFile[] {
  if (workspaceFiles.length === 0) {
    return contextFiles;
  }

  return contextFiles.filter(
    (file) => !isContextFileShadowedByWorkspaceSearch(file, workspaceFiles)
  );
}

function isUserOutputArtifact(artifact: AgentSessionArtifactManifestEntry): boolean {
  const workspacePath = artifact.workspaceRelativePath
    ? normalizeTemplateFilePath(artifact.workspaceRelativePath)
    : "";

  if (artifact.role === "output") {
    return true;
  }

  if (isTemplateOutputDirectoryPath(workspacePath)) {
    return true;
  }

  return (
    !artifact.role.startsWith("workspace-") &&
    artifact.role !== "output-last-message"
  );
}

function mergePanelInputFiles(
  context: TemplateFilePanelContext,
  inputFiles: TemplatePanelFile[]
): TemplateFilePanelContext {
  if (inputFiles.length === 0) {
    return context;
  }

  const inputMap = new Map(context.inputFiles.map((file) => [file.key, file]));
  for (const file of inputFiles) {
    inputMap.set(file.key, file);
  }

  return {
    ...context,
    inputFiles: [...inputMap.values()].sort(sortTemplateFilesByFreshness),
  };
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

function nativeFolderPathForTemplateFile(file: TemplatePanelFile): string | null {
  if (file.agentId && file.workspacePath) {
    return agentEngineClient.agentWorkspaceFolderNativeOpenPath(
      file.agentId,
      file.workspacePath
    );
  }

  return file.artifact ? `${file.artifact.downloadUrl}/open-folder-native` : null;
}

function outputDirectoryAncestors(workspacePath: string | null | undefined): string[] {
  if (!workspacePath) {
    return [];
  }

  const normalized = normalizeTemplateFilePath(workspacePath);
  if (!isTemplateOutputDirectoryPath(normalized)) {
    return [];
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return [];
  }

  const directories: string[] = [];
  for (let index = 2; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join("/"));
  }

  return directories;
}

function rememberOutputDirectory(input: {
  outputMap: Map<string, TemplatePanelFile>;
  directoryPath: string;
  agentId: string | null;
  createdAt: string;
  expected?: boolean;
}): void {
  const directoryPath = normalizeTemplateFilePath(input.directoryPath);
  if (!directoryPath || templatePathKind(directoryPath) !== "directory") {
    return;
  }

  const key = `output:${templateFileKey(directoryPath)}`;
  const existing = input.outputMap.get(key);
  input.outputMap.set(key, {
    key,
    kind: "directory",
    role: "output",
    name: existing?.name ?? templateFileName(directoryPath),
    detail: directoryPath,
    contentType: null,
    size: null,
    agentId: existing?.agentId ?? input.agentId,
    workspacePath: directoryPath,
    artifact: existing?.artifact ?? null,
    createdAt: existing
      ? latestCreatedAt(existing.createdAt, input.createdAt)
      : input.createdAt,
    expected: input.expected ?? false,
  });
}

function templateFilePanelFiles(
  context: TemplateFilePanelContext | null
): TemplatePanelFile[] {
  return context ? [...context.outputFiles, ...context.inputFiles] : [];
}

function templateFilePathEquals(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }

  return templateFileKey(left) === templateFileKey(right);
}

function findPanelFileForWorkspacePath(
  context: TemplateFilePanelContext | null,
  agentId: string,
  workspacePath: string
): TemplatePanelFile | null {
  const normalizedPath = normalizeTemplateFilePath(workspacePath);
  if (!normalizedPath) {
    return null;
  }

  return (
    templateFilePanelFiles(context).find(
      (file) =>
        file.workspacePath &&
        templateFilePathEquals(file.workspacePath, normalizedPath) &&
        (!file.agentId || file.agentId === agentId)
    ) ?? null
  );
}

function panelFileMatchesArtifact(
  file: TemplatePanelFile,
  artifact: AgentSessionArtifactManifestEntry
): boolean {
  if (file.artifact?.downloadUrl === artifact.downloadUrl) {
    return true;
  }

  if (
    file.artifact &&
    file.artifact.role === artifact.role &&
    file.artifact.name === artifact.name
  ) {
    return true;
  }

  if (
    artifact.workspaceRelativePath &&
    templateFilePathEquals(file.workspacePath, artifact.workspaceRelativePath)
  ) {
    return true;
  }

  return (
    file.role === "output" &&
    file.name === artifact.name &&
    (!file.contentType || file.contentType === artifact.contentType)
  );
}

function findPanelFileForArtifact(
  context: TemplateFilePanelContext | null,
  artifact: AgentSessionArtifactManifestEntry
): TemplatePanelFile | null {
  const files = templateFilePanelFiles(context);

  return (
    files.find(
      (file) => file.role === "output" && panelFileMatchesArtifact(file, artifact)
    ) ??
    files.find((file) => panelFileMatchesArtifact(file, artifact)) ??
    null
  );
}

function findPanelFileForAttachment(
  context: TemplateFilePanelContext | null,
  attachment: RockyAttachmentRecord
): TemplatePanelFile | null {
  const inputFiles = templateFilePanelFiles(context).filter(
    (file) => file.role === "input"
  );
  const workspacePath = attachment.workspacePath
    ? normalizeTemplateFilePath(attachment.workspacePath)
    : null;
  const expectedKey = `input:${workspacePath ?? attachment.id}`;

  return (
    inputFiles.find((file) => file.key === expectedKey) ??
    inputFiles.find(
      (file) => workspacePath && templateFilePathEquals(file.workspacePath, workspacePath)
    ) ??
    inputFiles.find(
      (file) =>
        file.name === attachment.name &&
        file.size === attachment.size &&
        file.createdAt === attachment.addedAt
    ) ??
    null
  );
}

function findPanelFileForConversationTarget(
  context: TemplateFilePanelContext | null,
  target: RockyConversationFileTarget
): TemplatePanelFile | null {
  switch (target.kind) {
    case "artifact":
      return findPanelFileForArtifact(context, target.artifact);
    case "attachment":
      return findPanelFileForAttachment(context, target.attachment);
    case "workspace-path":
      return findPanelFileForWorkspacePath(context, target.agentId, target.path);
  }
}

function conversationFileTargetName(target: RockyConversationFileTarget): string {
  switch (target.kind) {
    case "artifact":
      return target.artifact.name;
    case "attachment":
      return target.attachment.name;
    case "workspace-path":
      return templateFileName(target.path);
  }
}

function conversationFileTargetDetail(target: RockyConversationFileTarget): string {
  switch (target.kind) {
    case "artifact":
      return target.artifact.workspaceRelativePath ?? target.artifact.role;
    case "attachment":
      return target.attachment.workspacePath ?? "업로드 원본";
    case "workspace-path":
      return target.pathKind === "directory" ? `${target.path}/` : target.path;
  }
}

function buildConversationFileSelectionError(
  target: RockyConversationFileTarget
): TemplateFilePanelSelectionError {
  return {
    title: conversationFileTargetName(target),
    detail: conversationFileTargetDetail(target),
    message: "이 파일은 현재 파일 관리 목록에 없어 미리볼 수 없습니다.",
  };
}

function buildWorkspacePreviewPanelSource(
  input: {
    agentId: string;
    preview: AgentWorkspaceFilePreviewRecord;
    workspacePath: string;
  }
): RockyPreviewPanelSource | null {
  const { agentId, preview, workspacePath } = input;
  const inlinePreviewHref = preview.inlinePreviewUrl
    ? agentEngineClient.resolveApiPath(preview.inlinePreviewUrl)
    : null;
  const downloadHref = agentEngineClient.resolveApiPath(preview.downloadUrl);
  const detail = `${preview.path} · ${preview.contentType}`;
  const base = {
    contentType: preview.contentType,
    detail,
    downloadHref,
    folderOpenPath: agentEngineClient.agentWorkspaceFolderNativeOpenPath(
      agentId,
      workspacePath
    ),
    name: preview.name,
    previewHref: inlinePreviewHref,
  };

  if (preview.previewKind === "html") {
    return {
      ...base,
      kind: "html",
      nativeOpenPath: null,
    };
  }

  if (isPowerPointFile(preview.name, preview.contentType)) {
    return {
      ...base,
      kind: "powerpoint",
      nativeOpenPath: agentEngineClient.agentWorkspaceFileNativeOpenPath(
        agentId,
        workspacePath
      ),
    };
  }

  if (isXlsxFile(preview.name, preview.contentType)) {
    return {
      ...base,
      kind: "spreadsheet",
      nativeOpenPath: null,
      previewHref: workspacePreviewPageHref(agentId, workspacePath),
    };
  }

  if (
    baseContentType(preview.contentType) === "application/pdf" ||
    preview.name.toLowerCase().endsWith(".pdf")
  ) {
    return {
      ...base,
      kind: "pdf",
      nativeOpenPath: null,
    };
  }

  if (preview.previewKind === "image") {
    return {
      ...base,
      kind: "image",
      nativeOpenPath: null,
    };
  }

  if (preview.previewKind === "markdown") {
    return {
      ...base,
      kind: "markdown",
      nativeOpenPath: null,
    };
  }

  if (preview.previewKind === "text" || preview.previewKind === "code") {
    return {
      ...base,
      kind: "text",
      nativeOpenPath: null,
    };
  }

  return null;
}

async function listSkillInputDirectoryFiles(input: {
  agentId: string;
  searchPath: string;
  skillDisplayName: string;
}): Promise<TemplatePanelFile[]> {
  let directory;
  try {
    directory = await agentEngineClient.listAgentWorkspace(
      input.agentId,
      input.searchPath
    );
  } catch {
    return [];
  }

  const files: TemplatePanelFile[] = [];
  const children = await Promise.all(
    directory.entries.map(async (entry: AgentWorkspaceEntryRecord) => {
      if (entry.kind === "directory") {
        return listSkillInputDirectoryFiles({
          ...input,
          searchPath: entry.path,
        });
      }

      if (isIgnoredPanelFileName(entry.name)) {
        return [];
      }

      return [
        {
          key: `input:skill:${input.agentId}:${entry.path}`,
          role: "input" as const,
          name: entry.name,
          detail: `스킬: ${input.skillDisplayName}`,
          contentType: entry.contentType,
          size: entry.size,
          agentId: input.agentId,
          workspacePath: entry.path,
          artifact: null,
          createdAt: entry.updatedAt,
          expected: false,
        },
      ];
    })
  );

  for (const group of children) {
    files.push(...group);
  }

  return files.sort(sortTemplateFilesByFreshness);
}

async function listSkillPackagedInputFiles(
  source: SkillInputSource
): Promise<TemplatePanelFile[]> {
  if (!SAFE_WORKSPACE_SKILL_ID_PATTERN.test(source.skillId)) {
    return [];
  }

  const rootPath = `.agents/skills/${source.skillId}/assets/inputs`;
  return listSkillInputDirectoryFiles({
    agentId: source.agentId,
    searchPath: rootPath,
    skillDisplayName: source.skillDisplayName,
  });
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
  if (!isTemplateOutputDirectoryPath(normalized)) {
    return false;
  }

  const pathKind = templatePathKind(normalized);
  if (pathKind === "directory") {
    return true;
  }

  if (outputKind === "powerpoint") {
    const filename = templateFileName(normalized);
    return /\.pptx?$/iu.test(filename);
  }

  return true;
}

function isTemplateOutputDirectoryPath(value: string): boolean {
  const normalized = normalizeTemplateFilePath(value).toLowerCase();
  return normalized.startsWith("outputs/");
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
  onOpenConversationFile: (target: RockyConversationFileTarget) => void
): void {
  onOpenConversationFile({ kind: "artifact", artifact });
}

function openRockyWorkspacePath(
  agentId: string,
  path: string,
  pathKind: "file" | "directory" | "ambiguous",
  onOpenConversationFile: (target: RockyConversationFileTarget) => void
): void {
  const normalizedPath = path.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!normalizedPath) {
    return;
  }

  onOpenConversationFile({
    kind: "workspace-path",
    agentId,
    path: normalizedPath,
    pathKind,
  });
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

function findLatestPreviewableArtifact(
  chat: RockyChatRecord,
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>
): AgentSessionArtifactManifestEntry | null {
  let bestOutput: AgentSessionArtifactManifestEntry | null = null;
  let bestOutputAt = "";

  for (const dispatch of chat.dispatches) {
    const orchestration = dispatch.orchestration;
    if (!orchestration?.sessionId) continue;
    const transcript = transcriptsBySessionId[orchestration.sessionId] ?? [];

    for (const message of transcript) {
      if (orchestration.runId && message.runId !== orchestration.runId) continue;
      const artifacts = splitTranscriptArtifacts(message.artifacts).visibleArtifacts;
      const messageUpdatedAt = message.createdAt ?? "";

      for (const artifact of artifacts) {
        if (!isUserOutputArtifact(artifact)) continue;
        if (!buildArtifactPreviewPanelSource(artifact)) continue;
        if (messageUpdatedAt >= bestOutputAt) {
          bestOutput = artifact;
          bestOutputAt = messageUpdatedAt;
        }
      }
    }
  }

  return bestOutput;
}

function buildChatAttachmentPreviewSource(
  _chat: RockyChatRecord
): RockyPreviewPanelSource | null {
  // Chat-level attachments don't expose a public download URL — the file is
  // stored under rocky-core's workspace (uploads/rocky/...), and the agent
  // workspace API isn't routed for rocky-core. Skip the synthetic source and
  // wait for the run's input artifact to come in via transcripts instead.
  return null;
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
      if (templatePathKind(normalized) === "directory") {
        return false;
      }
      return (
        normalized === workspacePath ||
        templateFileName(normalized).toLowerCase() === artifactName
      );
    }) ?? null
  );
}

function isUnderTemplateOutputDirectory(
  workspacePath: string | null,
  outputPaths: string[]
): boolean {
  if (!workspacePath) {
    return false;
  }

  const normalizedWorkspacePath = normalizeTemplateFilePath(workspacePath);
  return outputPaths.some((outputPath) => {
    const normalizedOutputPath = normalizeTemplateFilePath(outputPath);
    return (
      templatePathKind(normalizedOutputPath) === "directory" &&
      normalizedWorkspacePath.startsWith(`${normalizedOutputPath}/`)
    );
  });
}

function outputArtifactKey(input: {
  artifact: AgentSessionArtifactManifestEntry;
  explicitOutputPath: string | null;
  workspacePath: string | null;
}): string {
  const workspacePath = normalizeTemplateFilePath(input.workspacePath ?? "");
  if (workspacePath) {
    return `output:${templateFileKey(workspacePath)}`;
  }

  const explicitOutputPath = normalizeTemplateFilePath(input.explicitOutputPath ?? "");
  if (explicitOutputPath) {
    return `output:${templateFileKey(explicitOutputPath)}`;
  }

  return `output:${templateFileName(
    input.artifact.name
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
    .filter((inputPath) => !isIgnoredPanelWorkspacePath(inputPath))
    .filter(Boolean);
  const explicitOutputPaths = [
    ...new Set(
      [...(template?.outputFiles ?? []), ...parsedTemplate.outputFiles]
        .map(normalizeTemplateFilePath)
        .filter((outputPath) => !isIgnoredPanelWorkspacePath(outputPath))
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
      if (isIgnoredPanelWorkspacePath(outputPath)) {
        continue;
      }

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
      if (isIgnoredPanelWorkspacePath(outputPath)) {
        continue;
      }

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
      if (isIgnoredPanelWorkspacePath(outputPath)) {
        continue;
      }

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

    if (isIgnoredPanelFileName(attachment.name)) {
      continue;
    }

    const workspacePath = attachment.workspacePath
      ? normalizeTemplateFilePath(attachment.workspacePath)
      : null;
    if (isIgnoredPanelWorkspacePath(workspacePath)) {
      continue;
    }

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
      kind: templatePathKind(outputPath),
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
    if (isIgnoredPanelWorkspacePath(observed.path)) {
      continue;
    }

    const key = `output:${templateFileKey(observed.path)}`;
    const existing = outputMap.get(key);
    outputMap.set(key, {
      key,
      kind: templatePathKind(observed.path),
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
      if (
        isIgnoredPanelFileName(artifact.name) ||
        isIgnoredPanelWorkspacePath(workspacePath)
      ) {
        continue;
      }

      const explicitOutputPath = matchExplicitTemplateOutputPath(
        artifact,
        workspacePath,
        outputPathsForMatching
      );
      const matchesOutputDirectory = isUnderTemplateOutputDirectory(
        workspacePath,
        outputPathsForMatching
      );

      if (
        outputPathsForMatching.length > 0 &&
        !explicitOutputPath &&
        !matchesOutputDirectory
      ) {
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
      for (const directoryPath of outputDirectoryAncestors(resolvedWorkspacePath)) {
        rememberOutputDirectory({
          outputMap,
          directoryPath,
          agentId: orchestration.agentId ?? agentId,
          createdAt,
        });
      }
      outputMap.set(key, {
        key,
        kind: "file",
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

function buildGeneralFilePanelContext(input: {
  chat: RockyChatRecord | null;
  packagedInputFiles: TemplatePanelFile[];
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
}): TemplateFilePanelContext | null {
  if (!input.chat) {
    return null;
  }

  const inputMap = new Map<string, TemplatePanelFile>();
  const outputMap = new Map<string, TemplatePanelFile>();

  for (const attachment of input.chat.attachments) {
    if (isIgnoredPanelFileName(attachment.name)) {
      continue;
    }

    const workspacePath = attachment.workspacePath
      ? normalizeTemplateFilePath(attachment.workspacePath)
      : null;
    if (isIgnoredPanelWorkspacePath(workspacePath)) {
      continue;
    }

    const key = `input:${workspacePath ?? attachment.id}`;
    inputMap.set(key, {
      key,
      role: "input",
      name: attachment.name,
      detail: workspacePath ?? "업로드 원본",
      contentType: attachment.contentType,
      size: attachment.size,
      agentId: input.chat.worker?.agentId ?? null,
      workspacePath,
      artifact: null,
      createdAt: attachment.addedAt,
      expected: false,
    });
  }

  for (const file of input.packagedInputFiles) {
    inputMap.set(file.key, file);
  }

  for (const dispatch of input.chat.dispatches) {
    const orchestration = dispatch.orchestration;
    if (!orchestration?.sessionId) {
      continue;
    }

    const transcript = input.transcriptsBySessionId[orchestration.sessionId] ?? [];
    const scopedMessages = transcript.filter(
      (message) =>
        message.role === "assistant" &&
        (!orchestration.runId || message.runId === orchestration.runId)
    );

    for (const message of scopedMessages) {
      const artifacts = splitTranscriptArtifacts(message.artifacts).visibleArtifacts;

      for (const artifact of artifacts) {
        if (!isUserOutputArtifact(artifact)) {
          continue;
        }

        const workspacePath = artifact.workspaceRelativePath
          ? normalizeTemplateFilePath(artifact.workspaceRelativePath)
          : null;
        if (
          isIgnoredPanelFileName(artifact.name) ||
          isIgnoredPanelWorkspacePath(workspacePath)
        ) {
          continue;
        }

        const key = `output:${templateFileKey(workspacePath ?? artifact.role)}`;
        const existing = outputMap.get(key);
        const createdAt = message.createdAt ?? dispatch.createdAt;
        for (const directoryPath of outputDirectoryAncestors(workspacePath)) {
          rememberOutputDirectory({
            outputMap,
            directoryPath,
            agentId: orchestration.agentId,
            createdAt,
          });
        }
        outputMap.set(key, {
          key,
          kind: "file",
          role: "output",
          name: existing?.name ?? artifact.name,
          detail: workspacePath ?? artifact.role,
          contentType: artifact.contentType,
          size: artifact.size,
          agentId: orchestration.agentId,
          workspacePath,
          artifact,
          createdAt: existing
            ? latestCreatedAt(existing.createdAt, createdAt)
            : createdAt,
          expected: false,
        });
      }
    }
  }

  const inputFiles = [...inputMap.values()].sort(sortTemplateFilesByFreshness);
  const outputFiles = [...outputMap.values()].sort(sortTemplateFilesByFreshness);

  if (inputFiles.length === 0 && outputFiles.length === 0) {
    return null;
  }

  const usedSkillNames = [
    ...new Set(
      input.chat.messages.flatMap((message) =>
        message.usedSkills.map((skill) => skill.displayName)
      )
    ),
  ];

  return {
    title: usedSkillNames.length > 0 ? usedSkillNames.join(", ") : input.chat.title,
    outputFormatLabel: "파일 관리",
    inputFiles,
    outputFiles,
    hasExplicitOutputFiles: false,
    active: input.chat.dispatches.some((dispatch) => {
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
  onOpenConversationFile,
  workspaceRoot,
}: {
  agentId: string | null;
  artifacts: AgentSessionArtifactManifestEntry[];
  markdown: string;
  onOpenConversationFile: (target: RockyConversationFileTarget) => void;
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
                    openRockyArtifact(artifact, onOpenConversationFile);
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
                  openRockyWorkspacePath(
                    agentId,
                    path,
                    pathKind,
                    onOpenConversationFile
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
  onOpenConversationFile,
}: {
  artifacts: AgentSessionArtifactManifestEntry[];
  onOpenConversationFile: (target: RockyConversationFileTarget) => void;
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
            onClick={() => openRockyArtifact(artifact, onOpenConversationFile)}
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
  onOpenConversationFile,
}: {
  attachments: RockyAttachmentRecord[];
  isRocky: boolean;
  onOpenConversationFile: (target: RockyConversationFileTarget) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onOpenConversationFile({ kind: "attachment", attachment })}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs transition",
            isRocky ? "bg-muted" : "bg-background/15"
          )}
        >
          <FileText className="size-3" />
          <span className="truncate">{attachment.name}</span>
        </button>
      ))}
    </div>
  );
}

function UsedSkillBadges({
  pending = false,
  skills,
}: {
  pending?: boolean;
  skills: RockyMessageRecord["usedSkills"];
}) {
  if (skills.length === 0) {
    return null;
  }

  const label = pending ? "사용 중인 스킬" : "사용한 스킬";

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <Badge
          key={skill.id}
          variant="outline"
          className="h-6 rounded-md border-primary/25 bg-primary/5 px-2 text-[11px] text-foreground"
        >
          {label}: {skill.displayName}
        </Badge>
      ))}
    </div>
  );
}

function MessageBubble({
  agentWorkspaceRootsByAgentId,
  chat,
  message,
  onOpenConversationFile,
  runProgressByRunId,
  transcriptsBySessionId,
}: {
  agentWorkspaceRootsByAgentId: Record<string, string>;
  chat: RockyChatRecord;
  message: RockyMessageRecord;
  onOpenConversationFile: (target: RockyConversationFileTarget) => void;
  runProgressByRunId: Record<string, string>;
  transcriptsBySessionId: Record<string, AgentSessionMessage[]>;
}) {
  const isRocky = message.role === "rocky";
  const dispatch =
    chat.dispatches.find((entry) => entry.id === message.dispatchId) ?? null;
  const agentId = dispatch?.orchestration?.agentId ?? null;
  const workspaceRoot = agentId ? agentWorkspaceRootsByAgentId[agentId] ?? null : null;
  const myAgentId = useTaskAgentId(chat.id);
  const myAgentQuery = useAgentQuery(myAgentId ?? undefined);
  const myAgentColor = myAgentQuery.data?.color ?? null;
  const replyBubbleStyle = myAgentColor
    ? {
        borderColor: `color-mix(in srgb, ${myAgentColor} 32%, var(--border))`,
        backgroundColor: `color-mix(in srgb, ${myAgentColor} 6%, var(--card))`,
      }
    : undefined;
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
  const usedSkills = isRocky ? message.usedSkills : [];

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
          className={cn(
            "w-full max-w-[52rem] text-sm leading-6 text-muted-foreground",
            myAgentColor
              ? "rounded-2xl border px-4 py-3 md:px-5"
              : "px-1 pb-2 pt-0 md:px-2",
          )}
          style={replyBubbleStyle}
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
          <UsedSkillBadges pending skills={usedSkills} />
        </article>
      </div>
    );
  }

  const bubbleText =
    !isRocky || rockyMessageState.kind === "pending"
      ? compactTemplateRunMessage(message.text)
      : rockyMessageState.text;
  const userFacingArtifacts = rockyMessageState.artifacts.filter(
    isUserOutputArtifact
  );
  const bubbleTone =
    isRocky && rockyMessageState.kind === "error"
      ? "text-destructive"
      : "text-foreground";

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
                "w-full max-w-[52rem]",
                myAgentColor ? "rounded-2xl border px-4 py-3 md:px-5" : "px-1 pb-2 pt-0 md:px-2",
                bubbleTone,
              )
            : cn(
                "max-w-[min(44rem,86%)] rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 md:px-5 text-slate-900",
              )
        )}
        style={isRocky ? replyBubbleStyle : undefined}
      >
        {isRocky ? <UsedSkillBadges skills={usedSkills} /> : null}
        {isRocky ? (
          rockyMessageState.kind === "error" ? (
            <div className="whitespace-pre-wrap">{bubbleText}</div>
          ) : (
            <RockyMarkdownViewer
              agentId={agentId}
              artifacts={userFacingArtifacts}
              markdown={bubbleText}
              onOpenConversationFile={onOpenConversationFile}
              workspaceRoot={workspaceRoot}
            />
          )
        ) : (
          <div className="whitespace-pre-wrap">{bubbleText}</div>
        )}
        <MessageAttachmentList
          attachments={attachments}
          isRocky={isRocky}
          onOpenConversationFile={onOpenConversationFile}
        />
        {isRocky ? (
          <RockyArtifactGrid
            artifacts={userFacingArtifacts}
            onOpenConversationFile={onOpenConversationFile}
          />
        ) : null}
      </article>
    </div>
  );
}

function formatTaskTimeRange(
  startedAt: string | null,
  endedAt: string | null
): string {
  if (!startedAt) {
    return "아직 없음";
  }

  return `${formatRockyTaskDateTime(startedAt)} ~ ${
    endedAt ? formatRockyTaskDateTime(endedAt) : "진행 중"
  }`;
}

function TaskConversationTimingSummary({ chat }: { chat: RockyChatRecord }) {
  const startedAt = getRockyTaskStartedAt(chat);
  const endedAt = getRockyTaskEndedAt(chat);
  const lastActivityAt = getRockyTaskLastActivityAt(chat);
  const items = [
    {
      label: "작업 시간",
      value: formatTaskTimeRange(startedAt, endedAt),
    },
    {
      label: "최근 작업",
      value: formatRockyTaskDateTime(lastActivityAt),
    },
    {
      label: "총 실행시간",
      value: formatRockyTaskDuration(startedAt, endedAt),
    },
  ];

  return (
    <div className="mx-auto mb-5 grid w-full max-w-4xl gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-xs shadow-sm sm:grid-cols-[1.4fr_1fr_0.8fr]">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0",
            index > 0 ? "sm:border-l sm:border-border/70 sm:pl-3" : null
          )}
        >
          <div className="font-medium text-muted-foreground">{item.label}</div>
          <div className="mt-1 break-keep text-sm font-semibold leading-5 text-foreground">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageList({
  agentWorkspaceRootsByAgentId,
  chat,
  endRef,
  onOpenConversationFile,
  runProgressByRunId,
  transcriptsBySessionId,
}: {
  agentWorkspaceRootsByAgentId: Record<string, string>;
  chat: RockyChatRecord;
  endRef: RefObject<HTMLDivElement | null>;
  onOpenConversationFile: (target: RockyConversationFileTarget) => void;
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
          onOpenConversationFile={onOpenConversationFile}
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

type ActiveFileMention = FileMentionRange & {
  query: string;
};

function activeFileMentionAt(value: string, caretIndex: number): ActiveFileMention | null {
  const beforeCaret = value.slice(0, caretIndex);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret);

  if (!match) {
    return null;
  }

  const leadingSpace = match[1] ?? "";
  const query = match[2] ?? "";
  const start = beforeCaret.length - match[0].length + leadingSpace.length;

  return {
    start,
    end: caretIndex,
    query,
  };
}

function fileMentionMatches(file: TemplatePanelFile, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [file.name, file.detail, templatePanelRoleLabel(file.role)]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function FileMentionMenu({
  activeIndex,
  files,
  onHover,
  onSelect,
}: {
  activeIndex: number;
  files: TemplatePanelFile[];
  onHover: (index: number) => void;
  onSelect: (file: TemplatePanelFile) => void;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg">
      <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">
        파일 지정
      </div>
      {files.map((file, index) => {
        const Icon = file.role === "input" ? FileInput : FileOutput;

        return (
          <button
            key={file.key}
            type="button"
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(file);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition",
              index === activeIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-secondary"
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
              <Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{fileMentionToken(file)}</span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                {panelFileDisplayDetail(file)}
              </span>
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {templatePanelRoleLabel(file.role)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChatComposer({
  canSend,
  canStop,
  errorMessage,
  files,
  mentionableFiles,
  message,
  onFilesChange,
  onFileRemove,
  onInsertFileMention,
  onStop,
  onMessageChange,
  onSubmit,
  textareaRef,
  stopPending,
}: {
  canSend: boolean;
  canStop: boolean;
  errorMessage: string | undefined;
  files: File[];
  mentionableFiles: TemplatePanelFile[];
  message: string;
  onFilesChange: (files: File[]) => void;
  onFileRemove: (file: File) => void;
  onInsertFileMention: (file: TemplatePanelFile, range?: FileMentionRange) => void;
  onStop: () => void;
  onMessageChange: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  stopPending: boolean;
}) {
  const [activeMention, setActiveMention] = useState<ActiveFileMention | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionOptions = useMemo(() => {
    if (!activeMention) {
      return [];
    }

    return mentionableFiles
      .filter((file) => fileMentionMatches(file, activeMention.query))
      .slice(0, 8);
  }, [activeMention, mentionableFiles]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [activeMention?.query, mentionOptions.length]);

  function updateActiveMention(value: string, caretIndex: number) {
    setActiveMention(
      mentionableFiles.length > 0
        ? activeFileMentionAt(value, caretIndex)
        : null
    );
  }

  function insertMention(file: TemplatePanelFile) {
    if (!activeMention) {
      onInsertFileMention(file);
      return;
    }

    onInsertFileMention(file, {
      start: activeMention.start,
      end: activeMention.end,
    });
    setActiveMention(null);
  }

  return (
    <footer className="shrink-0 bg-background px-3 pb-4 pt-2 md:px-6 md:pb-6">
      <form
        className="mx-auto w-full max-w-4xl rounded-2xl border bg-card p-2 shadow-sm"
        onSubmit={onSubmit}
      >
        <SelectedFileList files={files} onRemove={onFileRemove} />

        <FileMentionMenu
          activeIndex={activeMentionIndex}
          files={mentionOptions}
          onHover={setActiveMentionIndex}
          onSelect={insertMention}
        />

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
            ref={textareaRef}
            value={message}
            onBlur={() => {
              window.setTimeout(() => setActiveMention(null), 120);
            }}
            onChange={(event) => {
              onMessageChange(event.target.value);
              updateActiveMention(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length
              );
            }}
            onClick={(event) => {
              updateActiveMention(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? event.currentTarget.value.length
              );
            }}
            placeholder="PPT나 자료를 넣고 원하는 일을 말해보세요."
            aria-label="Rocky에게 말하기"
            className="max-h-36 min-h-10 flex-1 border-0 bg-transparent px-2 py-2.5 text-sm leading-5 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (activeMention && mentionOptions.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => {
                    const offset = event.key === "ArrowDown" ? 1 : -1;
                    return (current + offset + mentionOptions.length) % mentionOptions.length;
                  });
                  return;
                }

                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  insertMention(mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setActiveMention(null);
                  return;
                }
              }

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
            aria-label="보내기"
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

function panelLabelFor(kind: RockyPreviewPanelSource["kind"]): string {
  switch (kind) {
    case "powerpoint":
      return "PPT 뷰어";
    case "html":
      return "HTML 리포트";
    case "pdf":
      return "PDF 뷰어";
    case "image":
      return "이미지";
    case "markdown":
      return "마크다운";
    case "text":
      return "텍스트";
    case "spreadsheet":
      return "엑셀 뷰어";
  }
}

function isFetchedTextKind(kind: RockyPreviewPanelSource["kind"]): boolean {
  return kind === "html" || kind === "markdown" || kind === "text";
}

function previewSourceHasOriginalMode(source: RockyPreviewPanelSource): boolean {
  return isFetchedTextKind(source.kind);
}

function workspaceRecordHasOriginalMode(record: AgentWorkspaceFilePreviewRecord): boolean {
  return (
    TEXT_WORKSPACE_PREVIEW_KINDS.has(record.previewKind) &&
    typeof record.text === "string"
  );
}

function effectivePreviewModeFor(
  mode: PreviewMode,
  canUseOriginalMode: boolean
): PreviewMode {
  return canUseOriginalMode ? mode : "viewer";
}

function useFetchedArtifactText(source: RockyPreviewPanelSource | null): {
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; text: string }
    | { kind: "error"; message: string };
} {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; text: string }
    | { kind: "error"; message: string }
  >(() => (source && isFetchedTextKind(source.kind) ? { kind: "loading" } : { kind: "idle" }));

  useEffect(() => {
    if (!source || !isFetchedTextKind(source.kind)) {
      setState({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(source.downloadHref, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        setState({ kind: "ready", text: await response.text() });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message:
            error instanceof Error ? error.message : "미리보기를 불러오지 못했습니다.",
        });
      });

    return () => controller.abort();
  }, [source?.downloadHref, source?.kind]);

  return { state };
}

function copyArtifactText(text: string, name: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("클립보드를 사용할 수 없는 환경입니다.");
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${name} 내용을 복사했습니다.`))
    .catch(() => toast.error("복사에 실패했습니다."));
}

function SourceTextPreview({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "custom-scrollbar h-full min-h-full overflow-auto whitespace-pre-wrap break-words px-6 py-5 font-mono text-xs leading-6 text-foreground",
        className
      )}
    >
      {text || "빈 파일입니다."}
    </pre>
  );
}

function PreviewModeToggle({
  mode,
  onModeChange,
}: {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}) {
  return (
    <div className="inline-flex h-8 shrink-0 rounded-lg border border-border bg-muted/50 p-0.5">
      {(["viewer", "original"] as const).map((entry) => (
        <button
          key={entry}
          type="button"
          onClick={() => onModeChange(entry)}
          className={cn(
            "inline-flex min-w-14 items-center justify-center rounded-md px-2 text-xs font-semibold transition",
            mode === entry
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {entry === "viewer" ? "Viewer" : "원본"}
        </button>
      ))}
    </div>
  );
}

function canEmbedOriginalFile(contentType: string, name: string): boolean {
  const normalizedType = baseContentType(contentType);
  const normalizedName = name.toLowerCase();

  return (
    normalizedType === "application/pdf" ||
    normalizedType.startsWith("image/") ||
    normalizedType.startsWith("audio/") ||
    normalizedType.startsWith("video/") ||
    normalizedType === "text/html" ||
    normalizedType.startsWith("text/") ||
    normalizedName.endsWith(".pdf")
  );
}

function OriginalFilePreview({
  contentType,
  downloadHref,
  name,
  openHref,
}: {
  contentType: string;
  downloadHref: string | null;
  name: string;
  openHref: string | null;
}) {
  const href = openHref;

  if (href && canEmbedOriginalFile(contentType, name)) {
    if (baseContentType(contentType).startsWith("image/")) {
      return (
        <div className="flex min-h-full items-center justify-center bg-muted/40 p-3">
          <img src={href} alt={name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    }

    if (baseContentType(contentType).startsWith("audio/")) {
      return (
        <div className="flex min-h-full items-center justify-center bg-muted/40 p-4">
          <audio controls src={href} className="w-full" />
        </div>
      );
    }

    if (baseContentType(contentType).startsWith("video/")) {
      return (
        <video controls src={href} className="h-full w-full bg-black object-contain" />
      );
    }

    return (
      <iframe
        title={`${name} 원본`}
        src={href}
        className="h-full w-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center px-5 text-center text-sm text-muted-foreground">
      <div>
        <div>이 형식은 브라우저 안에서 원본을 직접 표시하기 어렵습니다.</div>
        <div className="mt-3 flex justify-center gap-2">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
            >
              <ExternalLink className="size-4" />
              새 창
            </a>
          ) : null}
          {downloadHref ? (
            <a
              href={downloadHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
            >
              <Download className="size-4" />
              다운로드
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SpreadsheetPreviewBody({
  downloadHref,
}: {
  downloadHref: string;
}) {
  return <XlsxWorkbookPreview sourceHref={downloadHref} />;
}

function ArtifactPreviewPanel({
  onClose,
  source,
}: {
  onClose: () => void;
  source: RockyPreviewPanelSource;
}) {
  const { state } = useFetchedArtifactText(source);
  const [nativeOpenPending, setNativeOpenPending] = useState(false);
  const [folderOpenPending, setFolderOpenPending] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("viewer");

  const panelLabel = panelLabelFor(source.kind);
  const closeLabel = `${panelLabel} 닫기`;
  const canUseOriginalMode = previewSourceHasOriginalMode(source);
  const effectivePreviewMode = effectivePreviewModeFor(previewMode, canUseOriginalMode);
  const nativeOpenLabel = nativeOpenPending
    ? "PowerPoint 여는 중"
    : "PowerPoint에서 열기";
  const previewOpenHref = source.previewHref ?? null;
  const canCopy =
    state.kind === "ready" && (source.kind === "markdown" || source.kind === "text");

  useEffect(() => {
    if (!canUseOriginalMode && previewMode === "original") {
      setPreviewMode("viewer");
    }
  }, [canUseOriginalMode, previewMode]);

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

  function openActualFolder(): void {
    if (!source.folderOpenPath || folderOpenPending) {
      return;
    }

    setFolderOpenPending(true);
    agentEngineClient
      .openNativeFile(source.folderOpenPath)
      .then(() => {
        toast.success("실제 폴더를 열었습니다.");
      })
      .catch((error: unknown) => {
        toast.error("실제 폴더를 열지 못했습니다.", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => setFolderOpenPending(false));
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
          {canUseOriginalMode ? (
            <PreviewModeToggle mode={previewMode} onModeChange={setPreviewMode} />
          ) : null}
          {canCopy && state.kind === "ready" ? (
            <button
              type="button"
              onClick={() => copyArtifactText(state.text, source.name)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
            >
              <Copy className="size-3.5" />
              복사
            </button>
          ) : null}
          {previewOpenHref ? (
            <a
              href={previewOpenHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary"
            >
              새 창
            </a>
          ) : null}
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
          {source.folderOpenPath ? (
            <button
              type="button"
              disabled={folderOpenPending}
              onClick={openActualFolder}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="size-3.5" />
              폴더
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
        <ArtifactPreviewBody mode={effectivePreviewMode} source={source} state={state} />
      </div>
    </aside>
  );
}

function ArtifactPreviewBody({
  mode,
  source,
  state,
}: {
  mode: PreviewMode;
  source: RockyPreviewPanelSource;
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; text: string }
    | { kind: "error"; message: string };
}) {
  if (mode === "original") {
    if (isFetchedTextKind(source.kind)) {
      if (state.kind === "loading") {
        return (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            원본을 불러오는 중입니다.
          </div>
        );
      }

      if (state.kind === "error") {
        return (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            원본을 불러오지 못했습니다. {state.message}
          </div>
        );
      }

      if (state.kind === "ready") {
        return <SourceTextPreview text={state.text} />;
      }

      return null;
    }

    return (
      <OriginalFilePreview
        contentType={source.contentType}
        downloadHref={source.downloadHref}
        name={source.name}
        openHref={source.previewHref ?? null}
      />
    );
  }

  if (source.kind === "spreadsheet") {
    return <SpreadsheetPreviewBody downloadHref={source.downloadHref} />;
  }

  if (source.kind === "powerpoint") {
    return (
      <div className="h-full bg-muted/40 p-4">
        <PptxArtifactPreview
          contentType={source.contentType}
          downloadHref={source.downloadHref}
          name={source.name}
          previewHref={source.previewHref}
        />
      </div>
    );
  }

  if (source.kind === "pdf") {
    return source.previewHref ? (
      <iframe
        title={`${source.name} PDF 미리보기`}
        src={source.previewHref}
        className="h-full w-full border-0"
      />
    ) : (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        PDF 미리보기를 준비하지 못했습니다.
      </div>
    );
  }

  if (source.kind === "image") {
    return source.previewHref ? (
      <div className="flex h-full items-center justify-center bg-muted/40 p-4">
        <img
          src={source.previewHref}
          alt={source.name}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    ) : (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        이미지 미리보기를 준비하지 못했습니다.
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        미리보기를 불러오는 중입니다.
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        미리보기를 불러오지 못했습니다. {state.message}
      </div>
    );
  }

  if (state.kind === "ready") {
    if (source.kind === "html") {
      return (
        <iframe
          title={`${source.name} HTML 미리보기`}
          srcDoc={state.text}
          sandbox=""
          className="h-full w-full border-0"
        />
      );
    }

    if (source.kind === "markdown") {
      return <MarkdownDocumentPreview markdown={state.text} />;
    }

    if (source.kind === "text") {
      return <SourceTextPreview text={state.text} />;
    }
  }

  return null;
}

function EmbeddedArtifactPreviewPanel({
  onClose,
  source,
}: {
  onClose: () => void;
  source: RockyPreviewPanelSource;
}) {
  const { state } = useFetchedArtifactText(source);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("viewer");
  const [folderOpenPending, setFolderOpenPending] = useState(false);
  const previewOpenHref = source.previewHref ?? null;
  const canUseOriginalMode = previewSourceHasOriginalMode(source);
  const effectivePreviewMode = effectivePreviewModeFor(previewMode, canUseOriginalMode);
  const canCopy =
    state.kind === "ready" && (source.kind === "markdown" || source.kind === "text");

  useEffect(() => {
    if (!canUseOriginalMode && previewMode === "original") {
      setPreviewMode("viewer");
    }
  }, [canUseOriginalMode, previewMode]);

  function openActualFolder(): void {
    if (!source.folderOpenPath || folderOpenPending) {
      return;
    }

    setFolderOpenPending(true);
    agentEngineClient
      .openNativeFile(source.folderOpenPath)
      .then(() => {
        toast.success("실제 폴더를 열었습니다.");
      })
      .catch((error: unknown) => {
        toast.error("실제 폴더를 열지 못했습니다.", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => setFolderOpenPending(false));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {panelLabelFor(source.kind)}
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {source.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {source.detail}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canUseOriginalMode ? (
            <PreviewModeToggle mode={previewMode} onModeChange={setPreviewMode} />
          ) : null}
          {canCopy && state.kind === "ready" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="내용 복사"
              title="내용 복사"
              onClick={() => copyArtifactText(state.text, source.name)}
            >
              <Copy className="size-4" />
            </Button>
          ) : null}
          {previewOpenHref ? (
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
          ) : null}
          {source.folderOpenPath ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="실제 폴더 열기"
              title="실제 폴더 열기"
              disabled={folderOpenPending}
              onClick={openActualFolder}
            >
              <FolderOpen className="size-4" />
            </Button>
          ) : null}
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
        <ArtifactPreviewBody mode={effectivePreviewMode} source={source} state={state} />
      </div>
    </div>
  );
}

function templatePanelRoleLabel(role: TemplatePanelFileRole): string {
  return role === "input" ? "입력" : "산출물";
}

function fileMentionToken(file: TemplatePanelFile): string {
  return `@${file.name}`;
}

function TemplateFileRow({
  file,
  onDelete,
  onMention,
  selected,
  onSelect,
}: {
  file: TemplatePanelFile;
  onDelete?: (file: TemplatePanelFile) => void;
  onMention?: (file: TemplatePanelFile) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon =
    templatePanelFileKind(file) === "directory"
      ? FolderOpen
      : file.role === "input"
        ? FileInput
        : FileOutput;
  const showDeleteAction = Boolean(onDelete && canDeleteTemplatePanelFile(file));
  const tone =
    file.role === "input"
      ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-700"
      : "border-sky-500/25 bg-sky-500/8 text-sky-700";

  return (
    <div
      className={cn(
        "group relative flex w-full rounded-lg border text-left transition",
        selected
          ? "border-primary/45 bg-primary/5 shadow-sm"
          : "border-border bg-background hover:bg-secondary/60"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-3 py-2.5 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50",
          showDeleteAction && onMention ? "pr-24" : "pr-12"
        )}
      >
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
            {panelFileDisplayDetail(file)}
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
      </button>
      {showDeleteAction ? (
        <button
          type="button"
          aria-label={`${file.name} 삭제`}
          title="삭제"
          onClick={() => onDelete?.(file)}
          className={cn(
            "absolute top-2 inline-flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100",
            onMention ? "right-16" : "right-2"
          )}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
      {onMention ? (
        <button
          type="button"
          aria-label={`${file.name} 채팅에 지정`}
          title="채팅에 지정"
          onClick={() => onMention(file)}
          className="absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground opacity-0 shadow-sm transition hover:bg-secondary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
        >
          <AtSign className="size-3" />
          지정
        </button>
      ) : null}
    </div>
  );
}

function TemplateFileSection({
  emptyText,
  files,
  leadingContent,
  onDelete,
  onMention,
  onSelect,
  selectedKey,
  title,
}: {
  emptyText: string;
  files: TemplatePanelFile[];
  leadingContent?: ReactNode;
  onDelete?: (file: TemplatePanelFile) => void;
  onMention?: (file: TemplatePanelFile) => void;
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
      {leadingContent}
      {files.length > 0 ? (
        <div className="space-y-2">
          {files.map((file) => (
            <TemplateFileRow
              key={file.key}
              file={file}
              onDelete={onDelete}
              onMention={onMention}
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

function BrowsedDirectoryControlCard({
  directory,
  onClose,
  onGoUp,
}: {
  directory: TemplatePanelFile;
  onClose: () => void;
  onGoUp: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
      <button
        type="button"
        onClick={onGoUp}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="상위 폴더로 이동"
        title="상위 폴더로 이동"
      >
        <ArrowLeft className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{directory.name}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {directory.workspacePath}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="전체 파일 목록으로 돌아가기"
        title="전체 파일 목록으로 돌아가기"
        className="shrink-0 text-muted-foreground"
        onClick={onClose}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function TemplateFilePanelSelectionErrorView({
  error,
}: {
  error: TemplateFilePanelSelectionError;
}) {
  return (
    <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 px-5 text-center">
      <div className="max-w-sm">
        <div className="text-sm font-semibold text-destructive">
          파일을 미리볼 수 없습니다.
        </div>
        <div className="mt-2 truncate text-sm font-medium text-foreground">
          {error.title}
        </div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {error.detail}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error.message}
        </p>
      </div>
    </div>
  );
}

function DirectoryPreviewBody({
  agentId,
  directory,
  onDeleteEntry,
  onOpenEntry,
  role,
  searchTerm,
}: {
  agentId: string | null;
  directory: AgentWorkspaceDirectoryRecord;
  onDeleteEntry?: (file: TemplatePanelFile) => void;
  onOpenEntry?: (file: TemplatePanelFile) => void;
  role: TemplatePanelFileRole;
  searchTerm: string;
}) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const entries = [...directory.entries]
    .filter((entry) => {
      if (!normalizedSearchTerm) {
        return true;
      }

      return [entry.name, entry.path, entry.kind === "directory" ? "폴더 folder" : "파일 file"]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearchTerm);
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "ko");
    });
  const parentEntry =
    agentId && directory.parentPath !== null
      ? templatePanelFileFromWorkspaceEntry({
          agentId,
          role,
          entry: {
            kind: "directory",
            name: directory.parentPath ? templateFileName(directory.parentPath) : ".",
            path: directory.parentPath || ".",
            contentType: null,
            size: null,
            updatedAt: new Date().toISOString(),
            previewKind: null,
          },
        })
      : null;

  return (
    <div className="h-full min-h-full bg-background">
      {entries.length > 0 || parentEntry ? (
        <div className="divide-y divide-border">
          {parentEntry ? (
            <button
              type="button"
              onClick={() => onOpenEntry?.(parentEntry)}
              className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">
                  상위 폴더
                </div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {parentEntry.workspacePath}
                </div>
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                폴더
              </div>
            </button>
          ) : null}
          {entries.map((entry) => {
            const Icon = entry.kind === "directory" ? FolderOpen : FileText;
            const file =
              agentId
                ? templatePanelFileFromWorkspaceEntry({
                    agentId,
                    role,
                    entry,
                  })
                : null;
            return (
              <div
                key={entry.path}
                className="group flex min-w-0 items-center gap-2 px-2 py-1.5 text-sm"
              >
                <button
                  type="button"
                  disabled={!file}
                  onClick={() => {
                    if (file) {
                      onOpenEntry?.(file);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">
                      {entry.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {entry.path}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground">
                    {entry.kind === "directory"
                      ? "폴더"
                      : typeof entry.size === "number"
                        ? formatFileSize(entry.size)
                        : "파일"}
                  </div>
                </button>
                {file && onDeleteEntry && canDeleteTemplatePanelFile(file) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${entry.name} 삭제`}
                    title="삭제"
                    className="shrink-0 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => onDeleteEntry(file)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {normalizedSearchTerm ? "검색 결과가 없습니다." : "폴더가 비어 있습니다."}
        </div>
      )}
    </div>
  );
}

function WorkspacePreviewBody({
  mode,
  record,
}: {
  mode: PreviewMode;
  record: AgentWorkspaceFilePreviewRecord;
}) {
  const canUseOriginalMode = workspaceRecordHasOriginalMode(record);
  const effectiveMode = effectivePreviewModeFor(mode, canUseOriginalMode);
  const inlinePreviewHref = record.inlinePreviewUrl
    ? agentEngineClient.resolveApiPath(record.inlinePreviewUrl)
    : null;
  const downloadHref = agentEngineClient.resolveApiPath(record.downloadUrl);
  const text = typeof record.text === "string" ? record.text : null;

  if (effectiveMode === "original" && text !== null) {
    return <SourceTextPreview text={text} className="px-4 py-4" />;
  }

  if (isXlsxFile(record.name, record.contentType)) {
    return <SpreadsheetPreviewBody downloadHref={downloadHref} />;
  }

  if (record.previewKind === "html" && text !== null) {
    return (
      <iframe
        title={`${record.name} HTML 미리보기`}
        srcDoc={text}
        sandbox=""
        className="h-full w-full border-0"
      />
    );
  }

  if (record.previewKind === "markdown" && text !== null) {
    return <MarkdownDocumentPreview markdown={text} className="px-4 py-4" />;
  }

  if ((record.previewKind === "text" || record.previewKind === "code") && text !== null) {
    return <SourceTextPreview text={text} className="px-4 py-4" />;
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
          downloadHref={downloadHref}
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
  mode,
}: {
  artifact: AgentSessionArtifactManifestEntry;
  mode: PreviewMode;
}) {
  const source = buildArtifactPreviewPanelSource(artifact);
  const { state } = useFetchedArtifactText(source);

  if (source) {
    const canUseOriginalMode = previewSourceHasOriginalMode(source);
    return (
      <ArtifactPreviewBody
        mode={effectivePreviewModeFor(mode, canUseOriginalMode)}
        source={source}
        state={state}
      />
    );
  }

  if (artifact.previewUrl) {
    return (
      <iframe
        title={`${artifact.name} 미리보기`}
        src={agentEngineClient.resolveApiPath(artifact.previewUrl)}
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

function findCurrentWorkspaceFileMatch(
  search: AgentWorkspaceSearchRecord | null | undefined,
  file: TemplatePanelFile | null
): AgentWorkspaceEntryRecord | null {
  if (!search || !file) {
    return null;
  }

  const normalizedName = file.name.trim().toLowerCase();
  const normalizedWorkspacePath = normalizeTemplateFilePath(file.workspacePath ?? "");
  const exactMatches = search.matches.filter(
    (entry) =>
      entry.kind === "file" &&
      entry.name.trim().toLowerCase() === normalizedName
  );

  if (exactMatches.length === 0) {
    return null;
  }

  const stillSamePath = exactMatches.find((entry) =>
    templateFilePathEquals(entry.path, normalizedWorkspacePath)
  );
  if (stillSamePath) {
    return stillSamePath;
  }

  return exactMatches
    .sort((left, right) => {
      const leftInOutputs = isTemplateOutputDirectoryPath(left.path) ? 1 : 0;
      const rightInOutputs = isTemplateOutputDirectoryPath(right.path) ? 1 : 0;
      if (leftInOutputs !== rightInOutputs) {
        return rightInOutputs - leftInOutputs;
      }

      const leftTime = new Date(left.updatedAt).getTime();
      const rightTime = new Date(right.updatedAt).getTime();
      return (
        (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0)
      );
    })[0] ?? null;
}

function TemplateSelectedFilePreview({
  active,
  file,
  onClose,
  onDeleteFile,
  onOpenWorkspaceEntry,
  searchTerm,
}: {
  active: boolean;
  file: TemplatePanelFile | null;
  onClose: () => void;
  onDeleteFile: (file: TemplatePanelFile) => void;
  onOpenWorkspaceEntry: (file: TemplatePanelFile) => void;
  searchTerm: string;
}) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("viewer");
  const [folderOpenPending, setFolderOpenPending] = useState(false);
  const wasActiveRef = useRef(active);
  const fileKind = templatePanelFileKind(file);
  const workspacePreviewQuery = useQuery({
    queryKey: [
      "rocky-template-file-preview",
      file?.agentId ?? "unknown",
      file?.workspacePath ?? "",
    ],
    queryFn: () =>
      agentEngineClient.getAgentWorkspaceFilePreview(
        file!.agentId!,
        file!.workspacePath!
      ),
    enabled: Boolean(file?.agentId && file.workspacePath && fileKind === "file"),
  });
  const workspaceResolveQuery = useQuery({
    queryKey: [
      "rocky-template-file-resolve",
      file?.agentId ?? "unknown",
      file?.name ?? "",
      file?.workspacePath ?? "",
    ],
    queryFn: () =>
      agentEngineClient.searchAgentWorkspace(
        file!.agentId!,
        file!.name
      ),
    enabled: Boolean(
      file?.agentId &&
        file.name &&
        file.workspacePath &&
        fileKind === "file" &&
        !file.expected &&
        workspacePreviewQuery.isError
    ),
  });
  const resolvedWorkspaceEntry = findCurrentWorkspaceFileMatch(
    workspaceResolveQuery.data,
    file
  );
  const resolvedWorkspacePreviewQuery = useQuery({
    queryKey: [
      "rocky-template-file-preview",
      file?.agentId ?? "unknown",
      resolvedWorkspaceEntry?.path ?? "",
    ],
    queryFn: () =>
      agentEngineClient.getAgentWorkspaceFilePreview(
        file!.agentId!,
        resolvedWorkspaceEntry!.path
      ),
    enabled: Boolean(
      file?.agentId &&
        fileKind === "file" &&
        workspacePreviewQuery.isError &&
        resolvedWorkspaceEntry?.path
    ),
  });
  const artifactPreviewSource = file?.artifact
    ? buildArtifactPreviewPanelSource(file.artifact)
    : null;
  const workspacePreviewRecord =
    workspacePreviewQuery.data ?? resolvedWorkspacePreviewQuery.data ?? null;
  const canUseOriginalMode = workspacePreviewRecord
    ? workspaceRecordHasOriginalMode(workspacePreviewRecord)
    : artifactPreviewSource
      ? previewSourceHasOriginalMode(artifactPreviewSource)
      : false;
  const effectivePreviewMode = effectivePreviewModeFor(previewMode, canUseOriginalMode);

  useEffect(() => {
    if (!canUseOriginalMode && previewMode === "original") {
      setPreviewMode("viewer");
    }
  }, [canUseOriginalMode, previewMode]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;

    if (!wasActive || active || !file?.agentId || !file.workspacePath) {
      return;
    }

    void workspacePreviewQuery.refetch();
  }, [
    active,
    file?.agentId,
    file?.workspacePath,
    fileKind,
    workspacePreviewQuery.refetch,
  ]);

  if (!file) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
        확인할 파일이 없습니다.
      </div>
    );
  }

  const effectiveWorkspacePath =
    workspacePreviewRecord?.path ??
    resolvedWorkspaceEntry?.path ??
    file.workspacePath ??
    null;
  const downloadHref =
    fileKind === "file" && file.agentId && effectiveWorkspacePath
      ? agentEngineClient.agentWorkspaceFileDownloadUrl(
          file.agentId,
          effectiveWorkspacePath
        )
      : file.artifact
        ? agentEngineClient.resolveApiPath(file.artifact.downloadUrl)
        : null;
  const openHref =
    fileKind === "file" && file.agentId && effectiveWorkspacePath
      ? workspacePreviewPageHref(file.agentId, effectiveWorkspacePath)
      : file.artifact?.previewUrl
        ? agentEngineClient.resolveApiPath(file.artifact.previewUrl)
        : null;
  const folderOpenPath =
    file.agentId && effectiveWorkspacePath
      ? agentEngineClient.agentWorkspaceFolderNativeOpenPath(
          file.agentId,
          effectiveWorkspacePath
        )
      : nativeFolderPathForTemplateFile(file);
  const fileRoleLabel = templatePanelRoleLabel(file.role);
  const displayDetail =
    workspacePreviewRecord && workspacePreviewRecord.path !== file.workspacePath
      ? workspacePreviewRecord.path
      : panelFileDisplayDetail(file);

  function openActualFolder(): void {
    if (!folderOpenPath || folderOpenPending) {
      return;
    }

    setFolderOpenPending(true);
    agentEngineClient
      .openNativeFile(folderOpenPath)
      .then(() => {
        toast.success(`${fileRoleLabel} 실제 폴더를 열었습니다.`);
      })
      .catch((error: unknown) => {
        toast.error("실제 폴더를 열지 못했습니다.", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => setFolderOpenPending(false));
  }

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
            {displayDetail}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canUseOriginalMode ? (
            <PreviewModeToggle mode={previewMode} onModeChange={setPreviewMode} />
          ) : null}
          {file.role === "output" && file.agentId && file.workspacePath ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="파일 새로고침"
              title="파일 새로고침"
              onClick={() => {
                void workspacePreviewQuery.refetch();
                void workspaceResolveQuery.refetch();
                if (resolvedWorkspaceEntry) {
                  void resolvedWorkspacePreviewQuery.refetch();
                }
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
          {folderOpenPath ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${fileRoleLabel} 실제 폴더 열기`}
              title={`${fileRoleLabel} 실제 폴더 열기`}
              disabled={folderOpenPending}
              onClick={openActualFolder}
            >
              <FolderOpen className="size-4" />
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
          {canDeleteTemplatePanelFile(file) ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${fileRoleLabel} 삭제`}
              title={`${fileRoleLabel} 삭제`}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDeleteFile(file)}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="미리보기 닫기"
            title="미리보기 닫기"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
        {fileKind === "directory" ? (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            폴더는 파일 목록에서 탐색합니다.
          </div>
        ) : workspacePreviewQuery.isLoading ? (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            파일을 불러오는 중입니다.
          </div>
        ) : workspacePreviewRecord ? (
          <WorkspacePreviewBody mode={effectivePreviewMode} record={workspacePreviewRecord} />
        ) : workspacePreviewQuery.isError &&
          (workspaceResolveQuery.isLoading || resolvedWorkspacePreviewQuery.isLoading) ? (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            이동된 파일 위치를 확인하는 중입니다.
          </div>
        ) : workspacePreviewQuery.isError && artifactPreviewSource ? (
          <ArtifactFallbackPreview artifact={file.artifact!} mode={effectivePreviewMode} />
        ) : workspacePreviewQuery.isError ? (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {file.expected ? "아직 생성되지 않았습니다." : "파일 내용을 불러오지 못했습니다."}
          </div>
        ) : file.artifact ? (
          <ArtifactFallbackPreview artifact={file.artifact} mode={effectivePreviewMode} />
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
  onWidthChange,
  onClose,
  onMentionFile,
  panelWidth,
  selectionRequest,
}: {
  context: TemplateFilePanelContext;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onMentionFile: (file: TemplatePanelFile) => void;
  panelWidth: number;
  selectionRequest: TemplateFilePanelSelectionRequest | null;
}) {
  const queryClient = useQueryClient();
  const [deletedTargets, setDeletedTargets] = useState<DeletedWorkspaceTarget[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [browsedFile, setBrowsedFile] = useState<TemplatePanelFile | null>(null);
  const [browsedDirectory, setBrowsedDirectory] =
    useState<TemplatePanelFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplatePanelFile | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const allFiles = [...context.outputFiles, ...context.inputFiles].filter(
    (file) => !isTemplateFileDeleted(file, deletedTargets)
  );
  const outputAgentId =
    allFiles.find((file) => file.role === "output" && file.agentId)?.agentId ??
    allFiles.find((file) => file.agentId)?.agentId ??
    null;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectionError, setSelectionError] =
    useState<TemplateFilePanelSelectionError | null>(null);
  const [fileListHeight, setFileListHeight] = useState(
    TEMPLATE_FILE_LIST_DEFAULT_HEIGHT
  );
  const fileSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const appliedSelectionRequestIdRef = useRef<number | null>(null);
  const fileKeySignature = allFiles.map((file) => file.key).join("\n");
  const normalizedSearchTerm = searchTerm.trim();
  const outputRootQuery = useQuery({
    queryKey: [
      "rocky-template-directory-preview",
      outputAgentId ?? "unknown",
      TEMPLATE_OUTPUTS_ROOT,
    ],
    queryFn: () =>
      agentEngineClient.listAgentWorkspace(outputAgentId!, TEMPLATE_OUTPUTS_ROOT),
    enabled: Boolean(outputAgentId),
  });
  const workspaceSearchAgentId = browsedDirectory?.agentId ?? outputAgentId;
  const workspaceSearchPath = browsedDirectory?.workspacePath ?? TEMPLATE_OUTPUTS_ROOT;
  const workspaceSearchQuery = useQuery({
    queryKey: [
      "rocky-template-directory-search",
      workspaceSearchAgentId ?? "unknown",
      workspaceSearchPath,
      normalizedSearchTerm,
    ],
    queryFn: () =>
      agentEngineClient.searchAgentWorkspace(
        workspaceSearchAgentId!,
        normalizedSearchTerm,
        workspaceSearchPath
      ),
    enabled: Boolean(
      workspaceSearchAgentId && workspaceSearchPath && normalizedSearchTerm
    ),
  });
  const contextOutputFiles = context.outputFiles.filter(
    (file) => !isTemplateFileDeleted(file, deletedTargets)
  );
  const shallowContextOutputFiles = collapseOutputFilesToOutputsRootChildren(
    removeExpectedOutputFilesResolvedElsewhere(contextOutputFiles)
  );
  const outputRootFiles =
    outputRootQuery.data && outputAgentId
      ? templatePanelFilesFromWorkspaceEntries({
          entries: outputRootQuery.data.entries,
          role: "output",
          agentId: outputAgentId,
        }).filter((file) => !isTemplateFileDeleted(file, deletedTargets))
      : [];
  const contextFallbackOutputFiles = outputRootQuery.data
    ? shallowContextOutputFiles.filter((file) => file.expected)
    : shallowContextOutputFiles;
  const initialOutputFiles = mergeTemplatePanelFiles(
    outputRootFiles,
    contextFallbackOutputFiles
  );
  const searchedOutputFiles =
    normalizedSearchTerm && workspaceSearchQuery.data && outputAgentId && !browsedDirectory
      ? templatePanelFilesFromWorkspaceEntries({
          entries: workspaceSearchQuery.data.matches,
          role: "output",
          agentId: outputAgentId,
        }).filter((file) => !isTemplateFileDeleted(file, deletedTargets))
      : [];
  const searchedContextOutputFiles = contextOutputFiles.filter((file) =>
    panelFileMatchesSearch(file, normalizedSearchTerm)
  );
  const visibleOutputFiles = normalizedSearchTerm
    ? mergeTemplatePanelFiles(
        searchedOutputFiles,
        removeContextFilesShadowedByWorkspaceSearch(
          searchedContextOutputFiles,
          searchedOutputFiles
        )
      )
    : initialOutputFiles;
  const visibleInputFiles = context.inputFiles
    .filter((file) => !isTemplateFileDeleted(file, deletedTargets))
    .filter((file) => panelFileMatchesSearch(file, normalizedSearchTerm));
  const selectedBrowsedFile =
    browsedFile &&
    selectedKey === browsedFile.key &&
    !isTemplateFileDeleted(browsedFile, deletedTargets)
      ? browsedFile
      : null;
  const selectedFile =
    selectionError
      ? null
      : selectedBrowsedFile ??
        allFiles.find((file) => file.key === selectedKey) ??
        null;
  const browsedDirectoryQuery = useQuery({
    queryKey: [
      "rocky-template-directory-preview",
      browsedDirectory?.agentId ?? "unknown",
      browsedDirectory?.workspacePath ?? "",
    ],
    queryFn: () =>
      agentEngineClient.listAgentWorkspace(
        browsedDirectory!.agentId!,
        browsedDirectory!.workspacePath!
      ),
    enabled: Boolean(browsedDirectory?.agentId && browsedDirectory.workspacePath),
  });
  const browsedDirectoryFiles =
    browsedDirectory && normalizedSearchTerm && workspaceSearchQuery.data
      ? templatePanelFilesFromWorkspaceEntries({
          entries: workspaceSearchQuery.data.matches,
          role: browsedDirectory.role,
          agentId: browsedDirectory.agentId!,
        }).filter((file) => !isTemplateFileDeleted(file, deletedTargets))
      : browsedDirectoryQuery.data && browsedDirectory?.agentId
        ? templatePanelFilesFromWorkspaceEntries({
            entries: browsedDirectoryQuery.data.entries,
            role: browsedDirectory.role,
            agentId: browsedDirectory.agentId,
          }).filter((file) => !isTemplateFileDeleted(file, deletedTargets))
        : [];
  const browsedDirectoryEmptyText = normalizedSearchTerm
    ? workspaceSearchQuery.isLoading
      ? "검색 중입니다."
      : workspaceSearchQuery.isError
        ? "검색 결과를 불러오지 못했습니다."
        : "검색 결과가 없습니다."
    : browsedDirectoryQuery.isLoading
      ? "폴더를 불러오는 중입니다."
      : browsedDirectoryQuery.isError
        ? "폴더 내용을 불러오지 못했습니다."
        : "폴더가 비어 있습니다.";

  useEffect(() => {
    if (selectionError) {
      return;
    }

    if (selectedBrowsedFile) {
      return;
    }

    setSelectedKey((current) =>
      current && allFiles.some((file) => file.key === current)
        ? current
        : null
    );
  }, [fileKeySignature, selectionError]);

  useEffect(() => {
    if (
      !selectionRequest ||
      appliedSelectionRequestIdRef.current === selectionRequest.id
    ) {
      return;
    }

    appliedSelectionRequestIdRef.current = selectionRequest.id;

    if (selectionRequest.error) {
      setSelectionError(selectionRequest.error);
      setSelectedKey(null);
      setBrowsedFile(null);
      setPreviewOpen(true);
      return;
    }

    if (
      selectionRequest.selectedKey &&
      allFiles.some((file) => file.key === selectionRequest.selectedKey)
    ) {
      setSelectionError(null);
      setBrowsedFile(null);
      setBrowsedDirectory(null);
      setSelectedKey(selectionRequest.selectedKey);
      setPreviewOpen(true);
    }
  }, [allFiles, selectionRequest]);

  function openDirectory(file: TemplatePanelFile): void {
    const normalizedPath = normalizeTemplateFilePath(file.workspacePath ?? "");
    if (
      file.role === "output" &&
      (!normalizedPath || normalizedPath === TEMPLATE_OUTPUTS_ROOT)
    ) {
      setBrowsedDirectory(null);
      return;
    }

    setBrowsedDirectory(file);
  }

  function handleSelectFile(file: TemplatePanelFile): void {
    setSelectionError(null);
    if (templatePanelFileKind(file) === "directory") {
      openDirectory(file);
      setBrowsedFile(null);
      setSelectedKey(null);
      setPreviewOpen(false);
      return;
    }

    setBrowsedFile(
      allFiles.some((candidate) => candidate.key === file.key) ? null : file
    );
    setSelectedKey(file.key);
    setPreviewOpen(true);
  }

  function handleOpenWorkspaceEntry(file: TemplatePanelFile): void {
    setSelectionError(null);
    if (templatePanelFileKind(file) === "directory") {
      openDirectory(file);
      setBrowsedFile(null);
      setSelectedKey(null);
      setPreviewOpen(false);
      return;
    }

    setBrowsedFile(file);
    setSelectedKey(file.key);
    setPreviewOpen(true);
  }

  function handleGoUpFromBrowsedDirectory(): void {
    if (!browsedDirectory?.agentId) {
      setBrowsedDirectory(null);
      return;
    }

    const parentPath = browsedDirectoryQuery.data?.parentPath ?? null;
    const normalizedParentPath = normalizeTemplateFilePath(parentPath ?? "");
    if (
      !normalizedParentPath ||
      normalizedParentPath === "." ||
      (browsedDirectory.role === "output" &&
        normalizedParentPath === TEMPLATE_OUTPUTS_ROOT)
    ) {
      setBrowsedDirectory(null);
      return;
    }

    setBrowsedDirectory(
      templatePanelFileFromDirectoryPath({
        agentId: browsedDirectory.agentId,
        role: browsedDirectory.role,
        path: normalizedParentPath,
      })
    );
    setBrowsedFile(null);
    setSelectedKey(null);
    setPreviewOpen(false);
  }

  async function confirmDeleteFile(): Promise<void> {
    if (!deleteTarget?.agentId || !deleteTarget.workspacePath) {
      setDeleteTarget(null);
      return;
    }

    const target = deleteTarget;
    const targetAgentId = target.agentId!;
    const targetWorkspacePath = target.workspacePath!;
    setDeletePending(true);

    try {
      await agentEngineClient.deleteAgentWorkspacePath(
        targetAgentId,
        targetWorkspacePath
      );
      setDeletedTargets((current) => [
        ...current,
        {
          agentId: targetAgentId,
          path: targetWorkspacePath,
        },
      ]);
      if (
        selectedFile?.agentId === targetAgentId &&
        selectedFile.workspacePath &&
        workspacePathContains(targetWorkspacePath, selectedFile.workspacePath)
      ) {
        setBrowsedFile(null);
        setSelectedKey(null);
        setPreviewOpen(false);
      }
      if (
        browsedDirectory?.agentId === targetAgentId &&
        browsedDirectory.workspacePath &&
        workspacePathContains(targetWorkspacePath, browsedDirectory.workspacePath)
      ) {
        setBrowsedDirectory(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rocky-template-file-preview"] }),
        queryClient.invalidateQueries({ queryKey: ["rocky-template-file-resolve"] }),
        queryClient.invalidateQueries({ queryKey: ["rocky-template-directory-preview"] }),
        queryClient.invalidateQueries({ queryKey: ["rocky-template-directory-search"] }),
      ]);
      setDeleteTarget(null);
      toast.success(
        templatePanelFileKind(target) === "directory"
        ? "폴더를 삭제했습니다."
        : "파일을 삭제했습니다.",
        {
          description: targetWorkspacePath,
        }
      );
    } catch (error) {
      toast.error("삭제에 실패했습니다.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeletePending(false);
    }
  }

  useEffect(() => {
    const container = fileSplitContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setFileListHeight((current) =>
        clampTemplateFileListHeight(current, container)
      );
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  function handlePanelResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(moveEvent: PointerEvent): void {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      onWidthChange(clampTemplateFilePanelWidth(nextWidth));
    }

    function cleanup(): void {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  function handlePanelResizeKeyDown(
    event: KeyboardEvent<HTMLDivElement>
  ): void {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    if (event.key === "Home") {
      onWidthChange(TEMPLATE_FILE_PANEL_MIN_WIDTH);
      return;
    }

    if (event.key === "End") {
      onWidthChange(maxTemplateFilePanelWidth());
      return;
    }

    onWidthChange(
      clampTemplateFilePanelWidth(
        panelWidth +
          (event.key === "ArrowLeft"
            ? TEMPLATE_FILE_PANEL_WIDTH_STEP
            : -TEMPLATE_FILE_PANEL_WIDTH_STEP)
      )
    );
  }

  function handleFileSplitPointerDown(
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    if (event.button !== 0) {
      return;
    }

    const container = fileSplitContainerRef.current;
    if (!container) {
      return;
    }

    event.preventDefault();
    const startY = event.clientY;
    const startHeight = fileListHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(moveEvent: PointerEvent): void {
      const nextHeight = startHeight + (moveEvent.clientY - startY);
      setFileListHeight(clampTemplateFileListHeight(nextHeight, container));
    }

    function cleanup(): void {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  function handleFileSplitKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const container = fileSplitContainerRef.current;
    const bounds = templateFileListHeightBounds(container);
    event.preventDefault();

    if (event.key === "Home") {
      setFileListHeight(bounds.min);
      return;
    }

    if (event.key === "End") {
      setFileListHeight(bounds.max);
      return;
    }

    setFileListHeight((current) =>
      clampTemplateFileListHeight(
        current +
          (event.key === "ArrowDown"
            ? TEMPLATE_FILE_SPLIT_STEP
            : -TEMPLATE_FILE_SPLIT_STEP),
        container
      )
    );
  }

  const panelStyle = {
    "--rocky-template-file-panel-width": `${panelWidth}px`,
  } as CSSProperties;
  const selectedKeyForList = selectionError ? null : selectedFile?.key ?? selectedKey;
  const fileListStyle = previewOpen ? { height: fileListHeight } : undefined;

  return (
    <aside
      className="relative flex h-[55vh] min-h-[24rem] w-full shrink-0 flex-col border-t border-border bg-card shadow-sm lg:h-auto lg:min-h-0 lg:w-[var(--rocky-template-file-panel-width)] lg:border-l lg:border-t-0"
      style={panelStyle}
    >
      <div
        role="separator"
        aria-label="오른쪽 파일 패널 너비 조절"
        aria-orientation="vertical"
        aria-valuemin={TEMPLATE_FILE_PANEL_MIN_WIDTH}
        aria-valuemax={maxTemplateFilePanelWidth()}
        aria-valuenow={Math.round(panelWidth)}
        tabIndex={0}
        onPointerDown={handlePanelResizePointerDown}
        onKeyDown={handlePanelResizeKeyDown}
        className="group absolute -left-1 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none outline-hidden lg:block"
      >
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border transition group-hover:bg-primary group-focus-visible:bg-primary" />
        <span className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition group-hover:bg-primary group-focus-visible:bg-primary" />
      </div>
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <LayoutTemplate className="size-4 text-muted-foreground" />
              파일 관리
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              산출물 {context.outputFiles.length}개 · 입력 {context.inputFiles.length}개
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {context.active ? (
              <Badge variant="secondary" className="shrink-0">
                진행 중
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="파일 패널 닫기"
              title="파일 패널 닫기"
              onClick={onClose}
            >
              <PanelRightClose className="size-4" />
            </Button>
          </div>
        </div>
        <div className="mt-3 flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            type="search"
            aria-label="파일 관리 검색"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="파일/폴더 검색"
            className="h-7 flex-1 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
          />
          {searchTerm ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="검색어 지우기"
              title="검색어 지우기"
              className="shrink-0 text-muted-foreground"
              onClick={() => setSearchTerm("")}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </header>

      <div
        ref={fileSplitContainerRef}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          className={cn(
            "custom-scrollbar min-h-0 space-y-5 overflow-y-auto px-4 py-4",
            previewOpen ? "shrink-0" : "flex-1"
          )}
          style={fileListStyle}
        >
          {browsedDirectory ? (
            <div className="space-y-3">
              {browsedDirectory.role === "output" ? (
                <>
                  <TemplateFileSection
                    title="산출물"
                    files={browsedDirectoryFiles}
                    leadingContent={
                      <BrowsedDirectoryControlCard
                        directory={browsedDirectory}
                        onClose={() => setBrowsedDirectory(null)}
                        onGoUp={handleGoUpFromBrowsedDirectory}
                      />
                    }
                    selectedKey={selectedKeyForList}
                    onDelete={setDeleteTarget}
                    onMention={onMentionFile}
                    emptyText={browsedDirectoryEmptyText}
                    onSelect={handleOpenWorkspaceEntry}
                  />
                  <TemplateFileSection
                    title="입력"
                    files={visibleInputFiles}
                    selectedKey={selectedKeyForList}
                    onDelete={setDeleteTarget}
                    onMention={onMentionFile}
                    emptyText={
                      normalizedSearchTerm
                        ? "검색 결과가 없습니다."
                        : "연결된 입력 파일이 없습니다."
                    }
                    onSelect={handleSelectFile}
                  />
                </>
              ) : (
                <>
                  <TemplateFileSection
                    title="산출물"
                    files={visibleOutputFiles}
                    selectedKey={selectedKeyForList}
                    onDelete={setDeleteTarget}
                    onMention={onMentionFile}
                    emptyText={
                      normalizedSearchTerm
                        ? workspaceSearchQuery.isLoading && visibleOutputFiles.length === 0
                          ? "검색 중입니다."
                          : workspaceSearchQuery.isError && visibleOutputFiles.length === 0
                            ? "검색 결과를 불러오지 못했습니다."
                            : "검색 결과가 없습니다."
                        : context.hasExplicitOutputFiles
                        ? "지정된 산출물 파일이 아직 생성되지 않았습니다."
                        : "아직 생성된 산출물 파일이 없습니다."
                    }
                    onSelect={handleSelectFile}
                  />
                  <TemplateFileSection
                    title="입력"
                    files={browsedDirectoryFiles}
                    leadingContent={
                      <BrowsedDirectoryControlCard
                        directory={browsedDirectory}
                        onClose={() => setBrowsedDirectory(null)}
                        onGoUp={handleGoUpFromBrowsedDirectory}
                      />
                    }
                    selectedKey={selectedKeyForList}
                    onDelete={setDeleteTarget}
                    onMention={onMentionFile}
                    emptyText={browsedDirectoryEmptyText}
                    onSelect={handleOpenWorkspaceEntry}
                  />
                </>
              )}
            </div>
          ) : (
            <>
              <TemplateFileSection
                title="산출물"
                files={visibleOutputFiles}
                selectedKey={selectedKeyForList}
                onDelete={setDeleteTarget}
                onMention={onMentionFile}
                emptyText={
                  normalizedSearchTerm
                    ? workspaceSearchQuery.isLoading && visibleOutputFiles.length === 0
                      ? "검색 중입니다."
                      : workspaceSearchQuery.isError && visibleOutputFiles.length === 0
                        ? "검색 결과를 불러오지 못했습니다."
                        : "검색 결과가 없습니다."
                    : context.hasExplicitOutputFiles
                    ? "지정된 산출물 파일이 아직 생성되지 않았습니다."
                    : "아직 생성된 산출물 파일이 없습니다."
                }
                onSelect={handleSelectFile}
              />
              <TemplateFileSection
                title="입력"
                files={visibleInputFiles}
                selectedKey={selectedKeyForList}
                onDelete={setDeleteTarget}
                onMention={onMentionFile}
                emptyText={
                  normalizedSearchTerm
                    ? "검색 결과가 없습니다."
                    : "연결된 입력 파일이 없습니다."
                }
                onSelect={handleSelectFile}
              />
            </>
          )}
        </div>
        {previewOpen ? (
          <>
            <div
              role="separator"
              aria-label="파일 목록과 미리보기 높이 조절"
              aria-orientation="horizontal"
              tabIndex={0}
              onPointerDown={handleFileSplitPointerDown}
              onKeyDown={handleFileSplitKeyDown}
              className="group relative h-2 shrink-0 cursor-row-resize touch-none border-y border-border bg-card outline-hidden"
            >
              <span className="absolute left-1/2 top-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition group-hover:bg-primary group-focus-visible:bg-primary" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-4">
              {selectionError ? (
                <TemplateFilePanelSelectionErrorView error={selectionError} />
              ) : (
                <TemplateSelectedFilePreview
                  active={context.active}
                  file={selectedFile}
                  onClose={() => setPreviewOpen(false)}
                  onDeleteFile={setDeleteTarget}
                  onOpenWorkspaceEntry={handleOpenWorkspaceEntry}
                  searchTerm={normalizedSearchTerm}
                />
              )}
            </div>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletePending) {
            setDeleteTarget(null);
          }
        }}
        title={
          templatePanelFileKind(deleteTarget) === "directory"
            ? "폴더를 삭제할까요?"
            : "파일을 삭제할까요?"
        }
        description={
          deleteTarget?.workspacePath
            ? templatePanelFileKind(deleteTarget) === "directory"
              ? `${deleteTarget.workspacePath} 폴더와 하위 항목이 삭제됩니다.`
              : `${deleteTarget.workspacePath} 파일이 삭제됩니다.`
            : undefined
        }
        confirmLabel="삭제"
        destructive
        pending={deletePending}
        onConfirm={() => {
          void confirmDeleteFile();
        }}
      />
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
  const [filePanelSelectionRequest, setFilePanelSelectionRequest] =
    useState<TemplateFilePanelSelectionRequest | null>(null);
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const [filePanelWidth, setFilePanelWidth] = useState(
    TEMPLATE_FILE_PANEL_DEFAULT_WIDTH
  );
  const [runProgressByRunId, setRunProgressByRunId] = useState<Record<string, string>>(
    {}
  );
  const submitInFlightRef = useRef(false);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const filePanelSignatureRef = useRef<string | null>(null);
  const filePanelSelectionRequestIdRef = useRef(0);
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
  const skillInputSources = useMemo<SkillInputSource[]>(() => {
    if (!chat) {
      return [];
    }

    const sources = new Map<string, SkillInputSource>();
    for (const messageEntry of chat.messages) {
      if (messageEntry.usedSkills.length === 0) {
        continue;
      }

      const dispatch = chat.dispatches.find(
        (entry) => entry.id === messageEntry.dispatchId
      );
      const agentId =
        dispatch?.orchestration?.agentId ?? chat.worker?.agentId ?? null;
      if (!agentId) {
        continue;
      }

      for (const skill of messageEntry.usedSkills) {
        const key = `${agentId}:${skill.id}`;
        sources.set(key, {
          agentId,
          skillId: skill.id,
          skillDisplayName: skill.displayName,
        });
      }
    }

    return [...sources.values()];
  }, [chat]);
  const packagedInputQueries = useQueries({
    queries: skillInputSources.map((source) => ({
      queryKey: [
        "rocky-skill-packaged-inputs",
        source.agentId,
        source.skillId,
      ],
      queryFn: () => listSkillPackagedInputFiles(source),
      enabled: Boolean(source.agentId && source.skillId),
      staleTime: 60_000,
    })),
  });
  const packagedInputFiles = packagedInputQueries.flatMap(
    (query) => query.data ?? []
  );
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
  const packagedInputRefreshMarker = packagedInputQueries
    .map((query) => `${query.dataUpdatedAt ?? 0}:${query.data?.length ?? 0}`)
    .join(":");
  const filePanelContext = useMemo(() => {
    const templateContext = buildTemplateFilePanelContext({
        chat,
        transcriptsBySessionId,
        userTemplates,
      });

    if (templateContext) {
      return mergePanelInputFiles(templateContext, packagedInputFiles);
    }

    return buildGeneralFilePanelContext({
      chat,
      packagedInputFiles,
      transcriptsBySessionId,
    });
  }, [chat, transcriptRefreshMarker, packagedInputRefreshMarker, userTemplates]);
  const filePanelSignature = filePanelContext
    ? [
        chat?.id ?? "no-chat",
        ...filePanelContext.inputFiles.map((file) => file.key),
        ...filePanelContext.outputFiles.map((file) => file.key),
      ].join("\n")
    : null;

  useEffect(() => {
    if (!filePanelSignature) {
      filePanelSignatureRef.current = null;
      return;
    }

    if (filePanelSignatureRef.current !== filePanelSignature) {
      filePanelSignatureRef.current = filePanelSignature;
      setFilePanelOpen(true);
    }
  }, [filePanelSignature]);

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
      setFilePanelSelectionRequest(null);
      return;
    }

    setChat((current) => (current?.id === routeTaskId ? current : null));
    setFilePanelSelectionRequest(null);
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
      setFilePanelSelectionRequest(null);
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

  const openConversationFile = (target: RockyConversationFileTarget) => {
    const selectedFile = findPanelFileForConversationTarget(filePanelContext, target);
    const nextId = filePanelSelectionRequestIdRef.current + 1;
    filePanelSelectionRequestIdRef.current = nextId;
    setFilePanelSelectionRequest({
      id: nextId,
      selectedKey: selectedFile?.key ?? null,
      error: selectedFile ? null : buildConversationFileSelectionError(target),
    });
    setFilePanelOpen(true);
  };
  const fallbackFilePanelContext =
    filePanelSelectionRequest?.error && !filePanelContext
      ? {
          title: "파일 미리보기",
          outputFormatLabel: "파일 관리",
          inputFiles: [],
          outputFiles: [],
          hasExplicitOutputFiles: false,
          active: false,
        }
      : null;
  const visibleFilePanelContext = filePanelContext ?? fallbackFilePanelContext;
  const mentionablePanelFiles = visibleFilePanelContext
    ? [...visibleFilePanelContext.outputFiles, ...visibleFilePanelContext.inputFiles]
    : [];
  const closeFilePanel = () => {
    setFilePanelOpen(false);
    setFilePanelSelectionRequest(null);
  };

  const insertFileMention = (
    file: TemplatePanelFile,
    range?: FileMentionRange
  ) => {
    let nextCursor = 0;

    setMessage((current) => {
      const textarea = composerTextareaRef.current;
      const fallbackStart = textarea?.selectionStart ?? current.length;
      const fallbackEnd = textarea?.selectionEnd ?? fallbackStart;
      const start = Math.max(0, Math.min(range?.start ?? fallbackStart, current.length));
      const end = Math.max(start, Math.min(range?.end ?? fallbackEnd, current.length));
      const prefix = current.slice(0, start);
      const suffix = current.slice(end);
      const leadingSpace = prefix.length > 0 && !/\s$/.test(prefix) ? " " : "";
      const trailingSpace = suffix.length === 0 || !/^\s/.test(suffix) ? " " : "";
      const mention = `${leadingSpace}${fileMentionToken(file)}${trailingSpace}`;
      nextCursor = prefix.length + mention.length;

      return `${prefix}${mention}${suffix}`;
    });

    window.requestAnimationFrame(() => {
      const textarea = composerTextareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background lg:flex-row">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {visibleFilePanelContext ? (
          <div className="pointer-events-none absolute right-4 top-4 z-20">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto bg-background/95 shadow-sm backdrop-blur"
              aria-label={filePanelOpen ? "파일 관리 패널 닫기" : "파일 관리 패널 열기"}
              onClick={() => {
                if (filePanelOpen) {
                  closeFilePanel();
                  return;
                }
                setFilePanelOpen(true);
              }}
            >
              {filePanelOpen ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
              파일 관리
            </Button>
          </div>
        ) : null}
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
            <>
              {isTaskDetail ? <TaskConversationTimingSummary chat={chat} /> : null}
              <MessageList
                agentWorkspaceRootsByAgentId={agentWorkspaceRootsByAgentId}
                chat={chat}
                endRef={messagesEndRef}
                onOpenConversationFile={openConversationFile}
                runProgressByRunId={runProgressByRunId}
                transcriptsBySessionId={transcriptsBySessionId}
              />
            </>
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
          canStop={canStop}
          errorMessage={errorMessage}
          files={files}
          mentionableFiles={mentionablePanelFiles}
          message={message}
          onFilesChange={setFiles}
          onFileRemove={(file) =>
            setFiles((current) => current.filter((item) => item !== file))
          }
          onInsertFileMention={insertFileMention}
          onStop={() => {
            void stopActiveResponse();
          }}
          onMessageChange={setMessage}
          onSubmit={submit}
          textareaRef={composerTextareaRef}
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

      {visibleFilePanelContext && filePanelOpen ? (
        <TemplateFilePanel
          context={visibleFilePanelContext}
          onWidthChange={(width) =>
            setFilePanelWidth(clampTemplateFilePanelWidth(width))
          }
          onClose={closeFilePanel}
          onMentionFile={insertFileMention}
          panelWidth={filePanelWidth}
          selectionRequest={filePanelSelectionRequest}
        />
      ) : null}
    </div>
  );
}

export { HomeDashboard as HomePage } from "./home-dashboard";

export function RockyTaskDetailPage() {
  return <RockyWorkspacePage mode="task-detail" />;
}
