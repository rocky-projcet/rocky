import type {
  AgentSessionArtifactManifestEntry,
  AgentSessionMessage,
  AgentSessionMessageBlock,
} from "../types.js";

export interface AssistantTranscriptSection {
  id: string;
  content: string;
  blocks?: AgentSessionMessageBlock[];
  artifacts?: AgentSessionArtifactManifestEntry[];
  source: string;
  createdAt: string;
  pending?: boolean;
}

export type TranscriptDisplayEntry =
  | {
      kind: "message";
      key: string;
      message: AgentSessionMessage;
    }
  | {
      kind: "assistant-group";
      key: string;
      runId: string;
      sections: AssistantTranscriptSection[];
    };

export type WorkspacePathKind = "file" | "directory" | "ambiguous";

export type WorkspaceTextSegment =
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "workspace-path";
      value: string;
      path: string;
      pathKind: WorkspacePathKind;
    };

const PATH_TOKEN_PATTERN = /[A-Za-z0-9._/-]+/g;
const TRAILING_PATH_PUNCTUATION_PATTERN = /[.,:;!?]+$/;
const IGNORED_WORKSPACE_PATH_SEGMENTS = new Set([
  ".git",
  ".venv",
  ".cache",
  ".mypy_cache",
  ".nox",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  "__pycache__",
  "node_modules",
]);
const TRANSCRIPT_INTERNAL_ARTIFACT_ROLE_HINTS = [
  "venv",
  "site-packages",
  "dist-info",
  "egg-info",
  "node-modules",
  "pycache",
  "pytest-cache",
  "mypy-cache",
  "ruff-cache",
  "tox",
  "nox",
];
const TRANSCRIPT_INTERNAL_ARTIFACT_NAMES = new Set([
  ".DS_Store",
  ".env.template",
  "AGENTS.md",
  "fontlist-v390.json",
]);
const TRANSCRIPT_INTERNAL_WORKSPACE_PATH_PREFIXES = [
  ".agents/",
  ".matplotlib-cache/",
  "scripts/",
];

export function buildTranscriptDisplayEntries(
  messages: AgentSessionMessage[]
): TranscriptDisplayEntry[] {
  const entries: TranscriptDisplayEntry[] = [];

  for (const message of messages) {
    const previous = entries.at(-1);
    if (
      previous?.kind === "assistant-group" &&
      canGroupAssistantMessage(previous.runId, message)
    ) {
      previous.sections.push(toAssistantSection(message));
      continue;
    }

    if (canStartAssistantGroup(message)) {
      entries.push({
        kind: "assistant-group",
        key: `${message.runId}:assistant-group:${entries.length + 1}`,
        runId: message.runId!,
        sections: [toAssistantSection(message)],
      });
      continue;
    }

    entries.push({
      kind: "message",
      key: message.id,
      message,
    });
  }

  return entries;
}

export function normalizeStreamingMarkdown(content: string): string {
  if (!content) {
    return content;
  }

  const fenceCount = content.match(/```/g)?.length ?? 0;
  if (fenceCount % 2 === 0) {
    return content;
  }

  return `${content}${content.endsWith("\n") ? "" : "\n"}\`\`\``;
}

export function formatElapsedDuration(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
  now = Date.now()
): string | null {
  if (!startedAt) {
    return null;
  }

  const startedAtMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  const endedAtMs = endedAt ? new Date(endedAt).getTime() : now;
  const boundedEndedAtMs =
    Number.isFinite(endedAtMs) && endedAtMs >= startedAtMs ? endedAtMs : startedAtMs;
  const elapsedMs = boundedEndedAtMs - startedAtMs;

  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

export function splitTextWithWorkspacePaths(
  text: string
): WorkspaceTextSegment[] {
  if (!text) {
    return [{ kind: "text", value: text }];
  }

  const segments: WorkspaceTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PATH_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    const token = match[0];
    const candidate = toWorkspacePathCandidate(token);
    if (!candidate) {
      continue;
    }

    if (index > cursor) {
      segments.push({
        kind: "text",
        value: text.slice(cursor, index),
      });
    }

    segments.push({
      kind: "workspace-path",
      value: candidate.value,
      path: candidate.path,
      pathKind: candidate.pathKind,
    });
    cursor = index + candidate.value.length;
  }

  if (cursor < text.length || segments.length === 0) {
    segments.push({
      kind: "text",
      value: text.slice(cursor),
    });
  }

  return segments;
}

export function isSuppressedTranscriptArtifact(
  artifact: Pick<
    AgentSessionArtifactManifestEntry,
    "role" | "name" | "contentType" | "workspaceRelativePath"
  >
): boolean {
  if (
    artifact.role === "output-last-message" &&
    artifact.contentType.startsWith("text/plain")
  ) {
    return true;
  }

  const normalizedRole = normalizeArtifactIdentifier(artifact.role);
  const normalizedName = normalizeArtifactIdentifier(artifact.name);
  const workspacePath = artifact.workspaceRelativePath?.replace(/^\.\/+/, "") ?? "";

  if (TRANSCRIPT_INTERNAL_ARTIFACT_NAMES.has(artifact.name)) {
    return true;
  }

  if (
    workspacePath &&
    TRANSCRIPT_INTERNAL_WORKSPACE_PATH_PREFIXES.some((prefix) =>
      workspacePath.startsWith(prefix)
    )
  ) {
    return true;
  }

  if (
    TRANSCRIPT_INTERNAL_ARTIFACT_ROLE_HINTS.some((hint) => normalizedRole.includes(hint))
  ) {
    return true;
  }

  if (
    artifact.role.startsWith("workspace-") &&
    (normalizedName === "activate" ||
      normalizedName.startsWith("activate-") ||
      normalizedName === "pyvenv-cfg" ||
      /^pip(?:\d+(?:-\d+)*)?$/.test(normalizedName) ||
      /^python(?:\d+(?:-\d+)*)?$/.test(normalizedName))
  ) {
    return true;
  }

  return false;
}

export function splitTranscriptArtifacts(
  artifacts: AgentSessionArtifactManifestEntry[] | undefined
): {
  visibleArtifacts: AgentSessionArtifactManifestEntry[];
  hiddenArtifactCount: number;
} {
  const visibleArtifacts: AgentSessionArtifactManifestEntry[] = [];
  let hiddenArtifactCount = 0;

  for (const artifact of artifacts ?? []) {
    if (isSuppressedTranscriptArtifact(artifact)) {
      hiddenArtifactCount += 1;
      continue;
    }

    visibleArtifacts.push(artifact);
  }

  return {
    visibleArtifacts,
    hiddenArtifactCount,
  };
}

function canStartAssistantGroup(message: AgentSessionMessage): boolean {
  return message.role === "assistant" && typeof message.runId === "string" && message.runId.length > 0;
}

function canGroupAssistantMessage(
  runId: string,
  message: AgentSessionMessage
): boolean {
  return message.role === "assistant" && message.runId === runId;
}

function toAssistantSection(
  message: AgentSessionMessage
): AssistantTranscriptSection {
  return {
    id: message.id,
    content: message.content,
    blocks: message.blocks,
    artifacts: message.artifacts,
    source: message.source,
    createdAt: message.createdAt,
  };
}

function normalizeArtifactIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toWorkspacePathCandidate(
  token: string
): { value: string; path: string; pathKind: WorkspacePathKind } | null {
  if (!token || token.includes("//") || token.startsWith("/") || token.startsWith("~")) {
    return null;
  }

  const tokenWithoutPunctuation = token.replace(TRAILING_PATH_PUNCTUATION_PATTERN, "");
  const trimmedToken = tokenWithoutPunctuation.replace(/\/+$/, "");
  if (!trimmedToken) {
    return null;
  }

  const normalizedPath = trimmedToken.startsWith("./")
    ? trimmedToken.slice(2)
    : trimmedToken;
  if (
    !normalizedPath ||
    normalizedPath.startsWith("../") ||
    normalizedPath === "." ||
    normalizedPath === ".."
  ) {
    return null;
  }

  const segments = normalizedPath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    return null;
  }

  if (segments.some((segment) => IGNORED_WORKSPACE_PATH_SEGMENTS.has(segment))) {
    return null;
  }

  const hasLowercaseHint = /[a-z]/.test(normalizedPath);
  const leaf = segments.at(-1) ?? "";
  const hasSlash = segments.length > 1;
  const isRootDotfile = !hasSlash && leaf.startsWith(".");
  if (!hasSlash && !isRootDotfile) {
    return null;
  }

  if (!isRootDotfile && !hasLowercaseHint) {
    return null;
  }

  if (
    hasSlash &&
    !leaf.includes(".") &&
    segments.some((segment) => segment.includes(".")) &&
    !token.endsWith("/")
  ) {
    return null;
  }

  if (
    hasSlash &&
    !leaf.includes(".") &&
    segments.length < 3 &&
    (segments[0]?.length ?? 0) < 3 &&
    !token.endsWith("/")
  ) {
    return null;
  }

  return {
    value: tokenWithoutPunctuation,
    path: normalizedPath,
    pathKind:
      isRootDotfile
        ? "ambiguous"
        : tokenWithoutPunctuation.endsWith("/") || !leaf.includes(".")
        ? "directory"
        : "file",
  };
}
