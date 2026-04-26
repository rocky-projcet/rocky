import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  RuntimeArtifactRef,
  RuntimeWorkspaceFileSnapshotEntry,
} from "./runtime-types.js";

const IGNORED_PATH_SEGMENTS = new Set([
  ".git",
  ".runtime",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  "node_modules",
]);

const MAX_CAPTURED_WORKSPACE_ARTIFACTS = 12;

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function shouldIgnoreRelativePath(relativePath: string): boolean {
  return normalizeRelativePath(relativePath)
    .split("/")
    .some((segment) => IGNORED_PATH_SEGMENTS.has(segment));
}

function buildWorkspaceArtifactRole(
  relativePath: string,
  usedRoles: Set<string>
): string {
  const normalized = normalizeRelativePath(relativePath);
  const withoutExtension = normalized.replace(/\.[^.]+$/, "");
  const base = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  let role = `workspace-${base || "artifact"}`;
  let suffix = 2;
  while (usedRoles.has(role)) {
    role = `workspace-${base || "artifact"}-${suffix}`;
    suffix += 1;
  }

  usedRoles.add(role);
  return role;
}

async function walkWorkspaceFiles(
  workspaceRoot: string,
  currentDir: string,
  snapshot: Map<string, RuntimeWorkspaceFileSnapshotEntry>
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizeRelativePath(
      path.relative(workspaceRoot, absolutePath)
    );

    if (!relativePath || shouldIgnoreRelativePath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkWorkspaceFiles(workspaceRoot, absolutePath, snapshot);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(absolutePath);
    snapshot.set(relativePath, {
      path: absolutePath,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    });
  }
}

export async function createWorkspaceSnapshot(
  workspaceRoot: string
): Promise<Map<string, RuntimeWorkspaceFileSnapshotEntry>> {
  const snapshot = new Map<string, RuntimeWorkspaceFileSnapshotEntry>();
  const resolved = path.resolve(workspaceRoot);
  try {
    await walkWorkspaceFiles(resolved, resolved, snapshot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
  return snapshot;
}

export function buildOutputLastMessageArtifactRef(
  outputLastMessagePath: string | null | undefined
): RuntimeArtifactRef | null {
  if (!outputLastMessagePath) {
    return null;
  }

  return {
    kind: "file",
    role: "output-last-message",
    path: outputLastMessagePath,
  };
}

export function deriveArtifactsDir(
  outputLastMessagePath: string | null | undefined
): string | null {
  if (!outputLastMessagePath) {
    return null;
  }

  return path.dirname(path.resolve(outputLastMessagePath));
}

export async function captureWorkspaceArtifacts({
  workspaceRoot,
  artifactsDir,
  beforeSnapshot,
  excludedPaths = [],
}: {
  workspaceRoot: string;
  artifactsDir: string;
  beforeSnapshot: Map<string, RuntimeWorkspaceFileSnapshotEntry>;
  excludedPaths?: string[];
}): Promise<{
  artifactRefs: RuntimeArtifactRef[];
  skippedCount: number;
}> {
  const excludedAbsolutePaths = new Set(
    excludedPaths.map((entry) => path.resolve(entry))
  );
  const currentSnapshot = await createWorkspaceSnapshot(workspaceRoot);
  const changedFiles = [...currentSnapshot.entries()]
    .filter(
      ([relativePath, entry]) => {
        if (excludedAbsolutePaths.has(path.resolve(entry.path))) {
          return false;
        }

        const before = beforeSnapshot.get(relativePath);
        return (
          !before ||
          before.size !== entry.size ||
          before.mtimeMs !== entry.mtimeMs
        );
      }
    )
    .map(([relativePath, entry]) => ({ relativePath, entry }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const selectedFiles = changedFiles.slice(0, MAX_CAPTURED_WORKSPACE_ARTIFACTS);
  const usedRoles = new Set<string>();
  const artifactRefs: RuntimeArtifactRef[] = [];

  for (const { relativePath, entry } of selectedFiles) {
    const artifactPath = path.join(artifactsDir, "workspace", relativePath);
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await copyFile(entry.path, artifactPath);

    artifactRefs.push({
      kind: "file",
      role: buildWorkspaceArtifactRole(relativePath, usedRoles),
      path: artifactPath,
      workspaceRelativePath: normalizeRelativePath(relativePath),
    });
  }

  return {
    artifactRefs,
    skippedCount: Math.max(0, changedFiles.length - selectedFiles.length),
  };
}
