import path from "node:path";

export type RuntimeArtifactPresentation = "file" | "image" | "chart";
export type RuntimeArtifactPreferredAction = "preview" | "download";

const INLINE_PREVIEW_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm",
]);
const PRESENTATION_PREVIEW_CONTENT_TYPES = new Set([
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function baseContentType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function normalizedBasename(filePath: string): string {
  return path.basename(filePath).toLowerCase();
}

function isEnvLikeFile(filePath: string): boolean {
  const basename = normalizedBasename(filePath);
  return basename === ".env" || basename.startsWith(".env.");
}

export function contentTypeForArtifactPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const basename = normalizedBasename(filePath);

  if (
    isEnvLikeFile(filePath) ||
    basename === ".gitignore" ||
    basename === ".dockerignore" ||
    basename === "dockerfile" ||
    basename === "makefile" ||
    basename === "procfile"
  ) {
    return "text/plain; charset=utf-8";
  }

  if (
    extension === ".txt" ||
    extension === ".log" ||
    extension === ".env" ||
    extension === ".template" ||
    extension === ".py" ||
    extension === ".rb" ||
    extension === ".java" ||
    extension === ".go" ||
    extension === ".rs" ||
    extension === ".php" ||
    extension === ".sh" ||
    extension === ".bash" ||
    extension === ".zsh" ||
    extension === ".sql" ||
    extension === ".toml" ||
    extension === ".ini" ||
    extension === ".conf" ||
    extension === ".ts" ||
    extension === ".tsx" ||
    extension === ".js" ||
    extension === ".jsx" ||
    extension === ".mjs" ||
    extension === ".cjs" ||
    extension === ".yml" ||
    extension === ".yaml"
  ) {
    return "text/plain; charset=utf-8";
  }

  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown; charset=utf-8";
  }

  if (extension === ".csv") {
    return "text/csv; charset=utf-8";
  }

  if (extension === ".html" || extension === ".htm") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".json" || extension === ".jsonl") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".xml") {
    return "application/xml; charset=utf-8";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".mp3") {
    return "audio/mpeg";
  }

  if (extension === ".m4a") {
    return "audio/mp4";
  }

  if (extension === ".ogg") {
    return "audio/ogg";
  }

  if (extension === ".wav") {
    return "audio/wav";
  }

  if (extension === ".mp4") {
    return "video/mp4";
  }

  if (extension === ".ogv") {
    return "video/ogg";
  }

  if (extension === ".mov") {
    return "video/quicktime";
  }

  if (extension === ".webm") {
    return "video/webm";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".doc") {
    return "application/msword";
  }

  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  if (extension === ".xls") {
    return "application/vnd.ms-excel";
  }

  if (extension === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  if (extension === ".ppt") {
    return "application/vnd.ms-powerpoint";
  }

  if (extension === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  return "application/octet-stream";
}

export function presentationForArtifact({
  role,
  name,
  contentType,
}: {
  role: string;
  name: string;
  contentType: string;
}): RuntimeArtifactPresentation {
  if (contentType.startsWith("image/")) {
    return "image";
  }

  const classifier = `${role} ${name}`.toLowerCase();
  if (/(chart|plot|graph|vega|mermaid|diagram)/.test(classifier)) {
    return "chart";
  }

  return "file";
}

export function artifactDownloadPath(runId: string, role: string): string {
  return `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(role)}`;
}

export function artifactPreviewPath(runId: string, role: string): string {
  return `${artifactDownloadPath(runId, role)}/preview`;
}

export function isInlinePreviewAllowed(contentType: string): boolean {
  return INLINE_PREVIEW_CONTENT_TYPES.has(baseContentType(contentType));
}

export function isPresentationPreviewAllowed(contentType: string): boolean {
  return PRESENTATION_PREVIEW_CONTENT_TYPES.has(baseContentType(contentType));
}

export function isPreviewAllowed(contentType: string): boolean {
  return isInlinePreviewAllowed(contentType) || isPresentationPreviewAllowed(contentType);
}

export function buildArtifactViewMetadata({
  runId,
  role,
  filePath,
}: {
  runId: string;
  role: string;
  filePath: string;
}): {
  name: string;
  contentType: string;
  presentation: RuntimeArtifactPresentation;
  previewable: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  preferredAction: RuntimeArtifactPreferredAction;
} {
  const name = path.basename(filePath);
  const contentType = contentTypeForArtifactPath(filePath);
  const presentation = presentationForArtifact({
    role,
    name,
    contentType,
  });
  const previewable = isPreviewAllowed(contentType);

  return {
    name,
    contentType,
    presentation,
    previewable,
    previewUrl: previewable ? artifactPreviewPath(runId, role) : null,
    downloadUrl: artifactDownloadPath(runId, role),
    preferredAction: previewable ? "preview" : "download",
  };
}
