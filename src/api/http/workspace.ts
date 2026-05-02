import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";

import type { FastifyReply } from "fastify";

import type { AgentRecord } from "../../agents/agent-types.js";
import type {
  AgentWorkspaceDirectoryRecord,
  AgentWorkspaceEntryRecord,
  AgentWorkspaceFilePreviewRecord,
  AgentWorkspacePreviewKind,
} from "../api-types.js";
import {
  baseContentType,
  contentTypeForArtifactPath,
  isInlinePreviewAllowed,
  isPresentationPreviewAllowed,
  isPreviewAllowed,
} from "../../runtime/runtime-artifact-metadata.js";
import {
  openFolder,
  openPowerPointFile,
  type NativeFileOpener,
  type NativeFileOpenRecord,
  type NativeFolderOpener,
} from "./native-open.js";
import { contentDispositionHeader } from "./content-disposition.js";
import { convertPresentationToPdfPreview } from "./office-preview.js";

const MAX_TEXT_PREVIEW_BYTES = 64 * 1024;
const WORKSPACE_UPLOADS_DIRECTORY = "uploads";
const CODE_PREVIEW_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".conf",
  ".css",
  ".go",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".template",
  ".toml",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const DOCUMENT_PREVIEW_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".pdf",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);
const TEXT_PREVIEW_KINDS = new Set<AgentWorkspacePreviewKind>([
  "text",
  "code",
  "markdown",
  "html",
]);

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 404,
  });
}

function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string): string {
  const relativePath = path.relative(workspaceRoot, targetPath);
  if (!relativePath || relativePath === ".") {
    return "";
  }

  return relativePath.split(path.sep).join("/");
}

export function ensureWorkspacePath(agent: AgentRecord, requestedPath?: string | null): {
  absolutePath: string;
  relativePath: string;
} {
  const rawPath = typeof requestedPath === "string" ? requestedPath.trim() : "";
  const normalizedInput = rawPath === "." ? "" : rawPath;
  const workspaceRoot = path.resolve(agent.workspaceRoot);
  const absolutePath = path.resolve(workspaceRoot, normalizedInput || ".");
  const workspacePrefix = `${workspaceRoot}${path.sep}`;

  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(workspacePrefix)) {
    throw badRequest(`Workspace path escapes agent root: ${requestedPath ?? ""}`);
  }

  return {
    absolutePath,
    relativePath: toWorkspaceRelativePath(workspaceRoot, absolutePath),
  };
}

function sanitizeUploadedFilename(filename: string): string {
  const basename = path.basename(filename.trim()).normalize("NFKC");
  const sanitized = basename
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return sanitized || "upload.bin";
}

async function statWorkspacePath(
  agent: AgentRecord,
  requestedPath?: string | null
): Promise<{
  absolutePath: string;
  relativePath: string;
  metadata: Awaited<ReturnType<typeof stat>>;
}> {
  const resolved = ensureWorkspacePath(agent, requestedPath);

  try {
    return {
      ...resolved,
      metadata: await stat(resolved.absolutePath),
    };
  } catch (error) {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError?.code === "ENOENT") {
      throw notFound(
        `Unknown workspace path: ${resolved.relativePath || requestedPath || "."}`
      );
    }
    throw error;
  }
}

function extensionForWorkspaceFile(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

function basenameForWorkspaceFile(filePath: string): string {
  return path.basename(filePath).toLowerCase();
}

function isEnvLikeWorkspaceFile(filePath: string): boolean {
  const basename = basenameForWorkspaceFile(filePath);
  return basename === ".env" || basename.startsWith(".env.");
}

function isMarkdownPreview(filePath: string, contentType: string): boolean {
  return (
    extensionForWorkspaceFile(filePath) === ".md" ||
    baseContentType(contentType) === "text/markdown"
  );
}

function isHtmlPreview(filePath: string, contentType: string): boolean {
  const extension = extensionForWorkspaceFile(filePath);
  const normalizedContentType = baseContentType(contentType);
  return (
    extension === ".html" ||
    extension === ".htm" ||
    normalizedContentType === "text/html"
  );
}

function isCodePreview(filePath: string, contentType: string): boolean {
  const extension = extensionForWorkspaceFile(filePath);
  const normalizedContentType = baseContentType(contentType);

  return (
    isEnvLikeWorkspaceFile(filePath) ||
    CODE_PREVIEW_EXTENSIONS.has(extension) ||
    normalizedContentType === "application/json" ||
    normalizedContentType === "application/xml" ||
    normalizedContentType === "text/css"
  );
}

function isTextPreviewContentType(contentType: string): boolean {
  const normalizedContentType = baseContentType(contentType);
  return (
    normalizedContentType.startsWith("text/") ||
    normalizedContentType === "application/json" ||
    normalizedContentType === "application/xml"
  );
}

function previewKindForWorkspaceFile(
  filePath: string,
  contentType: string
): AgentWorkspacePreviewKind {
  const normalizedContentType = baseContentType(contentType);
  const extension = extensionForWorkspaceFile(filePath);

  if (isMarkdownPreview(filePath, contentType)) {
    return "markdown";
  }

  if (isHtmlPreview(filePath, contentType)) {
    return "html";
  }

  if (normalizedContentType.startsWith("image/")) {
    return "image";
  }

  if (normalizedContentType.startsWith("audio/")) {
    return "audio";
  }

  if (normalizedContentType.startsWith("video/")) {
    return "video";
  }

  if (
    normalizedContentType === "application/pdf" ||
    DOCUMENT_PREVIEW_EXTENSIONS.has(extension)
  ) {
    return "document";
  }

  if (isCodePreview(filePath, contentType)) {
    return "code";
  }

  if (isTextPreviewContentType(contentType)) {
    return "text";
  }

  return "binary";
}

function hasInlineWorkspacePreview(
  previewKind: AgentWorkspacePreviewKind,
  contentType: string
): boolean {
  return (
    (previewKind === "image" ||
      previewKind === "audio" ||
      previewKind === "video" ||
      previewKind === "document") &&
    isPreviewAllowed(contentType)
  );
}

function parseSingleByteRange(
  rangeHeader: string,
  size: number
): { start: number; end: number } | null {
  if (!rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [segment] = rangeHeader.slice(6).split(",", 1);
  if (!segment) {
    return null;
  }

  const [rawStart, rawEnd] = segment.split("-", 2);
  if ((!rawStart && !rawEnd) || (rawStart && !/^\d+$/.test(rawStart)) || (rawEnd && !/^\d+$/.test(rawEnd))) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(size - suffixLength, 0);
    return {
      start,
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return null;
  }

  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function normalizeStatSize(size: number | bigint): number {
  return typeof size === "bigint" ? Number(size) : size;
}

function workspaceQuery(searchPath: string): string {
  const search = new URLSearchParams();
  search.set("path", searchPath);
  return search.toString();
}

export function workspaceDirectoryPath(agentId: string, searchPath = ""): string {
  const pathname = `/agents/${encodeURIComponent(agentId)}/workspace`;
  if (!searchPath) {
    return pathname;
  }

  return `${pathname}?${workspaceQuery(searchPath)}`;
}

export function workspaceFileMetadataPath(agentId: string, searchPath: string): string {
  return `/agents/${encodeURIComponent(agentId)}/workspace/file?${workspaceQuery(searchPath)}`;
}

export function workspaceFileDownloadPath(agentId: string, searchPath: string): string {
  return `/agents/${encodeURIComponent(agentId)}/workspace/file/content?${workspaceQuery(searchPath)}`;
}

export function workspaceFilePreviewPath(agentId: string, searchPath: string): string {
  return `/agents/${encodeURIComponent(agentId)}/workspace/file/preview?${workspaceQuery(searchPath)}`;
}

export function workspaceFileNativeOpenPath(agentId: string, searchPath: string): string {
  return `/agents/${encodeURIComponent(agentId)}/workspace/file/open-native?${workspaceQuery(searchPath)}`;
}

export function workspaceFolderNativeOpenPath(agentId: string, searchPath = ""): string {
  const pathname = `/agents/${encodeURIComponent(agentId)}/workspace/open-native`;
  if (!searchPath) {
    return pathname;
  }

  return `${pathname}?${workspaceQuery(searchPath)}`;
}

async function readTextPreview(filePath: string): Promise<{
  text: string;
  lineCount: number;
  truncated: boolean;
}> {
  const handle = await open(filePath, "r");

  try {
    const buffer = Buffer.alloc(MAX_TEXT_PREVIEW_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const truncated = bytesRead > MAX_TEXT_PREVIEW_BYTES;
    const content = buffer.subarray(0, truncated ? MAX_TEXT_PREVIEW_BYTES : bytesRead);
    const text = content.toString("utf8");

    return {
      text,
      lineCount: text.length === 0 ? 0 : text.split(/\r?\n/).length,
      truncated,
    };
  } finally {
    await handle.close();
  }
}

async function buildWorkspaceEntryRecord(
  agent: AgentRecord,
  directoryPath: string,
  entryName: string
): Promise<AgentWorkspaceEntryRecord | null> {
  const targetPath = path.join(directoryPath, entryName);
  const metadata = await stat(targetPath);
  const relativePath = toWorkspaceRelativePath(agent.workspaceRoot, targetPath);

  if (metadata.isDirectory()) {
    return {
      kind: "directory",
      name: entryName,
      path: relativePath,
      contentType: null,
      size: null,
      updatedAt: metadata.mtime.toISOString(),
      previewKind: null,
    };
  }

  if (!metadata.isFile()) {
    return null;
  }

  const contentType = contentTypeForArtifactPath(targetPath);

  return {
    kind: "file",
    name: entryName,
    path: relativePath,
    contentType,
    size: normalizeStatSize(metadata.size),
    updatedAt: metadata.mtime.toISOString(),
    previewKind: previewKindForWorkspaceFile(targetPath, contentType),
  };
}

export async function buildWorkspaceDirectoryRecord(
  agent: AgentRecord,
  requestedPath?: string | null
): Promise<AgentWorkspaceDirectoryRecord> {
  const { absolutePath, relativePath, metadata } = await statWorkspacePath(agent, requestedPath);

  if (!metadata.isDirectory()) {
    throw badRequest(`Workspace path is not a directory: ${relativePath || "."}`);
  }

  const entries = await readdir(absolutePath);
  const records = (
    await Promise.all(
      entries.map((entry) => buildWorkspaceEntryRecord(agent, absolutePath, entry))
    )
  )
    .filter((entry): entry is AgentWorkspaceEntryRecord => entry !== null)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  return {
    agentId: agent.id,
    workspaceRoot: agent.workspaceRoot,
    path: relativePath,
    parentPath: relativePath ? path.posix.dirname(relativePath).replace(/^\.$/, "") : null,
    entries: records,
  };
}

export async function buildWorkspaceFilePreviewRecord(
  agent: AgentRecord,
  requestedPath: string
): Promise<AgentWorkspaceFilePreviewRecord> {
  const { absolutePath, relativePath, metadata } = await statWorkspacePath(agent, requestedPath);

  if (!metadata.isFile()) {
    throw badRequest(`Workspace path is not a file: ${relativePath || "."}`);
  }

  const contentType = contentTypeForArtifactPath(absolutePath);
  const previewKind = previewKindForWorkspaceFile(absolutePath, contentType);
  let text: string | null = null;
  let lineCount: number | null = null;
  let truncated = false;

  if (TEXT_PREVIEW_KINDS.has(previewKind)) {
    const preview = await readTextPreview(absolutePath);
    text = preview.text;
    lineCount = preview.lineCount;
    truncated = preview.truncated;
  }

  return {
    agentId: agent.id,
    workspaceRoot: agent.workspaceRoot,
    path: relativePath,
    name: path.basename(absolutePath),
    contentType,
    size: normalizeStatSize(metadata.size),
    updatedAt: metadata.mtime.toISOString(),
    previewKind,
    text,
    lineCount,
    truncated,
    downloadUrl: workspaceFileDownloadPath(agent.id, relativePath),
    inlinePreviewUrl:
      hasInlineWorkspacePreview(previewKind, contentType)
        ? workspaceFilePreviewPath(agent.id, relativePath)
        : null,
  };
}

export async function writeWorkspaceUploadFile({
  agent,
  filename,
  contentBase64,
}: {
  agent: AgentRecord;
  filename: string;
  contentBase64: string;
}): Promise<AgentWorkspaceFilePreviewRecord> {
  const sanitizedFilename = sanitizeUploadedFilename(filename);
  const uploadRelativePath = path.posix.join(
    WORKSPACE_UPLOADS_DIRECTORY,
    randomUUID(),
    sanitizedFilename
  );
  const { absolutePath, relativePath } = ensureWorkspacePath(agent, uploadRelativePath);
  const body = Buffer.from(contentBase64, "base64");

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, body);

  return buildWorkspaceFilePreviewRecord(agent, relativePath);
}

export async function sendWorkspaceFileDownload(
  reply: FastifyReply,
  agent: AgentRecord,
  requestedPath: string
): Promise<void> {
  const { absolutePath, relativePath, metadata } = await statWorkspacePath(agent, requestedPath);

  if (!metadata.isFile()) {
    throw badRequest(`Workspace path is not a file: ${relativePath || "."}`);
  }

  const body = await readFile(absolutePath);

  reply.code(200);
  reply.header("Content-Type", contentTypeForArtifactPath(absolutePath));
  reply.header(
    "Content-Disposition",
    contentDispositionHeader("attachment", path.basename(absolutePath))
  );
  reply.header("Content-Length", String(body.byteLength));
  reply.send(body);
}

export async function openWorkspaceFileInPowerPoint(
  agent: AgentRecord,
  requestedPath: string,
  nativeFileOpener: NativeFileOpener = openPowerPointFile
): Promise<NativeFileOpenRecord> {
  const { absolutePath, relativePath, metadata } = await statWorkspacePath(
    agent,
    requestedPath
  );
  if (!metadata.isFile()) {
    throw badRequest(`Workspace path is not a file: ${relativePath || requestedPath}`);
  }

  const contentType = contentTypeForArtifactPath(absolutePath);
  if (!isPresentationPreviewAllowed(contentType)) {
    const error = new Error(
      `PowerPoint 직접 열기는 PPT/PPTX 워크스페이스 파일만 지원합니다: ${relativePath || requestedPath}`
    ) as Error & { statusCode: number };
    error.statusCode = 415;
    throw error;
  }

  return nativeFileOpener(absolutePath);
}

async function resolveWorkspaceNativeFolderTarget(
  agent: AgentRecord,
  requestedPath?: string | null
): Promise<{
  absolutePath: string;
  relativePath: string;
}> {
  const resolved = ensureWorkspacePath(agent, requestedPath);

  try {
    const metadata = await stat(resolved.absolutePath);
    if (metadata.isDirectory()) {
      return resolved;
    }

    if (metadata.isFile()) {
      const absolutePath = path.dirname(resolved.absolutePath);
      return {
        absolutePath,
        relativePath: toWorkspaceRelativePath(agent.workspaceRoot, absolutePath),
      };
    }

    throw badRequest(`Workspace path cannot be opened as a folder: ${resolved.relativePath || "."}`);
  } catch (error) {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError?.code !== "ENOENT") {
      throw error;
    }

    if (!resolved.relativePath) {
      throw notFound(`Unknown workspace path: ${requestedPath || "."}`);
    }

    const workspaceRoot = path.resolve(agent.workspaceRoot);
    const workspacePrefix = `${workspaceRoot}${path.sep}`;
    const parentPath = path.dirname(resolved.absolutePath);
    if (
      parentPath === resolved.absolutePath ||
      (parentPath !== workspaceRoot && !parentPath.startsWith(workspacePrefix))
    ) {
      throw notFound(`Unknown workspace path: ${resolved.relativePath}`);
    }

    try {
      const parentMetadata = await stat(parentPath);
      if (!parentMetadata.isDirectory()) {
        throw badRequest(`Workspace path parent is not a directory: ${resolved.relativePath}`);
      }
    } catch (parentError) {
      const parentFilesystemError = parentError as NodeJS.ErrnoException;
      if (parentFilesystemError?.code === "ENOENT") {
        throw notFound(`Unknown workspace path: ${resolved.relativePath}`);
      }
      throw parentError;
    }

    return {
      absolutePath: parentPath,
      relativePath: toWorkspaceRelativePath(agent.workspaceRoot, parentPath),
    };
  }
}

export async function openWorkspaceFolder(
  agent: AgentRecord,
  requestedPath?: string | null,
  nativeFolderOpener: NativeFolderOpener = openFolder
): Promise<NativeFileOpenRecord> {
  const target = await resolveWorkspaceNativeFolderTarget(agent, requestedPath);
  return nativeFolderOpener(target.absolutePath);
}

export async function sendWorkspaceFilePreview(
  reply: FastifyReply,
  agent: AgentRecord,
  requestedPath: string
): Promise<void> {
  const { absolutePath, relativePath, metadata } = await statWorkspacePath(agent, requestedPath);

  if (!metadata.isFile()) {
    throw badRequest(`Workspace path is not a file: ${relativePath || "."}`);
  }

  const contentType = contentTypeForArtifactPath(absolutePath);
  const normalizedType = baseContentType(contentType);
  if (isPresentationPreviewAllowed(contentType)) {
    const preview = await convertPresentationToPdfPreview(absolutePath);

    reply.code(200);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      contentDispositionHeader("inline", path.basename(preview.path))
    );
    reply.header("Content-Length", String(preview.body.byteLength));
    reply.send(preview.body);
    return;
  }

  if (!isInlinePreviewAllowed(contentType)) {
    const error = new Error(
      `Workspace file type does not support inline preview: ${relativePath || path.basename(absolutePath)}`
    ) as Error & { statusCode?: number };
    error.statusCode = 415;
    throw error;
  }

  const size = normalizeStatSize(metadata.size);
  const supportsByteRanges =
    normalizedType.startsWith("audio/") || normalizedType.startsWith("video/");
  const rangeHeader =
    supportsByteRanges && typeof reply.request.headers.range === "string"
      ? reply.request.headers.range
      : null;

  if (supportsByteRanges) {
    reply.header("Accept-Ranges", "bytes");
  }

  if (rangeHeader) {
    const range = parseSingleByteRange(rangeHeader, size);
    if (!range) {
      reply.code(416);
      reply.header("Content-Range", `bytes */${size}`);
      reply.send();
      return;
    }

    const body = await readFile(absolutePath);

    reply.code(206);
    reply.header("Content-Type", contentType);
    reply.header(
      "Content-Disposition",
      contentDispositionHeader("inline", path.basename(absolutePath))
    );
    reply.header("Content-Length", String(range.end - range.start + 1));
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    reply.send(body.subarray(range.start, range.end + 1));
    return;
  }

  const body = await readFile(absolutePath);

  reply.code(200);
  reply.header("Content-Type", contentType);
  reply.header(
    "Content-Disposition",
    contentDispositionHeader("inline", path.basename(absolutePath))
  );
  reply.header("Content-Length", String(body.byteLength));
  reply.send(body);
}
