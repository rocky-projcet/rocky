import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { FastifyReply } from "fastify";

import type { ArtifactRecord } from "../api-types.js";
import type { AgentRunRecord } from "../../sessions/session-types.js";
import type { RuntimeRunResult } from "../../runtime/runtime-types.js";
import {
  buildArtifactViewMetadata,
  contentTypeForArtifactPath,
  isInlinePreviewAllowed,
  isPresentationPreviewAllowed,
} from "../../runtime/runtime-artifact-metadata.js";
import { convertPresentationToPdfPreview } from "./office-preview.js";

function ensureArtifactPathInRun(run: AgentRunRecord, artifactPath: string): string {
  const resolvedArtifactPath = path.resolve(artifactPath);
  const resolvedArtifactsDir = path.resolve(run.artifactsDir);
  const artifactPrefix = `${resolvedArtifactsDir}${path.sep}`;

  if (
    resolvedArtifactPath !== resolvedArtifactsDir &&
    !resolvedArtifactPath.startsWith(artifactPrefix)
  ) {
    throw new Error(`Artifact path escapes run artifacts dir: ${artifactPath}`);
  }

  return resolvedArtifactPath;
}

export async function buildArtifactRecords(
  run: AgentRunRecord,
  result: RuntimeRunResult
): Promise<ArtifactRecord[]> {
  const artifacts: ArtifactRecord[] = [];

  for (const artifactRef of result.artifactRefs) {
    const artifactPath = ensureArtifactPathInRun(run, artifactRef.path);
    let size: number | null = null;
    try {
      size = (await stat(artifactPath)).size;
    } catch {
      size = null;
    }
    const view = buildArtifactViewMetadata({
      runId: run.id,
      role: artifactRef.role,
      filePath: artifactPath,
    });

    artifacts.push({
      kind: artifactRef.kind,
      role: artifactRef.role,
      name: view.name,
      contentType: view.contentType,
      presentation: view.presentation,
      size,
      previewable: view.previewable,
      previewUrl: view.previewUrl,
      downloadUrl: view.downloadUrl,
      preferredAction: view.preferredAction,
    });
  }

  return artifacts;
}

export async function sendArtifactDownload(
  reply: FastifyReply,
  run: AgentRunRecord,
  result: RuntimeRunResult,
  artifactRole: string
): Promise<void> {
  const artifactRef = result.artifactRefs.find((entry) => entry.role === artifactRole);
  if (!artifactRef) {
    throw new Error(`Unknown artifact role: ${artifactRole}`);
  }

  const artifactPath = ensureArtifactPathInRun(run, artifactRef.path);
  let body: Buffer;
  try {
    body = await readFile(artifactPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const notFound = new Error(`Artifact file not found: ${artifactRole}`) as Error & { statusCode: number };
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }

  reply.code(200);
  reply.header("Content-Type", contentTypeForArtifactPath(artifactPath));
  reply.header(
    "Content-Disposition",
    `attachment; filename="${path.basename(artifactPath)}"`
  );
  reply.header("Content-Length", String(body.byteLength));
  reply.send(body);
}

export async function sendArtifactPreview(
  reply: FastifyReply,
  run: AgentRunRecord,
  result: RuntimeRunResult,
  artifactRole: string
): Promise<void> {
  const artifactRef = result.artifactRefs.find((entry) => entry.role === artifactRole);
  if (!artifactRef) {
    throw new Error(`Unknown artifact role: ${artifactRole}`);
  }

  const artifactPath = ensureArtifactPathInRun(run, artifactRef.path);
  const contentType = contentTypeForArtifactPath(artifactPath);
  if (isPresentationPreviewAllowed(contentType)) {
    const preview = await convertPresentationToPdfPreview(artifactPath);

    reply.code(200);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename="${path.basename(preview.path)}"`
    );
    reply.header("Content-Length", String(preview.body.byteLength));
    reply.send(preview.body);
    return;
  }

  if (!isInlinePreviewAllowed(contentType)) {
    const error = new Error(
      `Artifact type does not support inline preview: ${artifactRole}`
    ) as Error & { statusCode?: number };
    error.statusCode = 415;
    throw error;
  }

  let body: Buffer;
  try {
    body = await readFile(artifactPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const notFound = new Error(`Artifact file not found: ${artifactRole}`) as Error & { statusCode: number };
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }
  reply.code(200);
  reply.header("Content-Type", contentType);
  reply.header(
    "Content-Disposition",
    `inline; filename="${path.basename(artifactPath)}"`
  );
  reply.header("Content-Length", String(body.byteLength));
  reply.send(body);
}
