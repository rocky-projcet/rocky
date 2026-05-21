import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CONNECTOR_EXECUTION_GATE_FILE,
  normalizeConnectorExecutionGate,
  type ConnectorExecutionGateManifest,
} from "../connectors/connector-execution-gate.js";

import {
  SkillTemplateStore,
  type RuntimeSkillTemplatePackageFileRecord,
  type RuntimeSkillTemplateRecord,
} from "./skill-template-store.js";

export type ExternalSkillSourceKind = "mcp-market" | "github" | "upload";

export interface ExternalSkillPackageFileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface ExternalSkillPreviewInput {
  sourceKind?: ExternalSkillSourceKind | null;
  sourceUrl?: string | null;
  files?: ExternalSkillPackageFileInput[];
}

export interface ExternalSkillPreviewCheck {
  id: string;
  status: "passed" | "warning" | "failed";
  message: string;
}

export interface ExternalSkillPreviewCapability {
  id: string;
  provider: string;
  action: string;
  scriptPath: string;
  requiresConnectedAccount: boolean;
  credentialGateStatus: "not-required" | "allowed" | "blocked";
  reasons: string[];
}

export interface ExternalSkillPreviewRecord {
  id: string;
  sourceKind: ExternalSkillSourceKind;
  sourceUrl: string | null;
  packageHash: string;
  installable: boolean;
  skillId: string;
  title: string;
  description: string | null;
  fileCount: number;
  checks: ExternalSkillPreviewCheck[];
  capabilities: ExternalSkillPreviewCapability[];
  createdAt: string;
}

export interface ExternalSkillMountResult {
  preview: ExternalSkillPreviewRecord;
  skill: RuntimeSkillTemplateRecord;
}

export interface ExternalSkillServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  skillTemplateStore?: SkillTemplateStore;
  fetchImpl?: typeof fetch;
}

interface StoredExternalSkillPreview {
  preview: ExternalSkillPreviewRecord;
  packageFiles: RuntimeSkillTemplatePackageFileRecord[];
  gate: ConnectorExecutionGateManifest | null;
  skillMarkdown: string;
}

interface GitHubPackageSource {
  owner: string;
  repo: string;
  ref: string;
  packagePaths: string[];
  skillsShSlug?: string;
}

interface GitHubContentEntry {
  type?: string;
  name?: string;
  path?: string;
  download_url?: string | null;
  content?: string;
  encoding?: string;
}

const REMOTE_PACKAGE_FILE_LIMIT = 200;
const REMOTE_PACKAGE_BYTE_LIMIT = 5 * 1024 * 1024;
const SKILLS_SH_DIRECTORY_SCAN_LIMIT = 160;
const SKILLS_SH_DIRECTORY_DEPTH_LIMIT = 4;

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

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveStateRoot(stateRoot?: string): string {
  return path.resolve(
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine"),
  );
}

function assertInside(root: string, targetPath: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw badRequest("Resolved path escapes the runtime state root.");
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeSourceKind(value: unknown): ExternalSkillSourceKind {
  return value === "mcp-market" || value === "github" || value === "upload"
    ? value
    : "upload";
}

function readSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    throw badRequest("External skill sourceUrl must be a valid URL.");
  }
}

function normalizeGitHubPath(value: string): string {
  const normalized = value.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw badRequest("GitHub skill package paths must stay inside the repository.");
  }
  return normalized;
}

function normalizeGitHubRepoName(value: string): string {
  return value.replace(/\.git$/u, "");
}

function parseSkillsShSourceUrl(sourceUrl: string): GitHubPackageSource | null {
  const parsed = new URL(sourceUrl);
  if (parsed.hostname !== "skills.sh" && parsed.hostname !== "www.skills.sh") {
    return null;
  }
  const [owner, repo, skill] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repo || !skill) {
    throw badRequest("skills.sh source URLs must include owner, repository, and skill.");
  }
  const skillPath = normalizeGitHubPath(skill);
  return {
    owner,
    repo: normalizeGitHubRepoName(repo),
    ref: parsed.searchParams.get("ref") ?? "main",
    packagePaths: [`skills/${skillPath}`, `.agents/skills/${skillPath}`, skillPath],
    skillsShSlug: skillPath,
  };
}

function parseGitHubSourceUrl(sourceUrl: string): GitHubPackageSource | null {
  const parsed = new URL(sourceUrl);
  if (parsed.hostname !== "github.com") {
    return null;
  }
  const [owner, repo, marker, ref, ...rest] = parsed.pathname
    .split("/")
    .filter(Boolean);
  if (!owner || !repo) {
    throw badRequest("GitHub source URLs must include an owner and repository.");
  }
  const skill = parsed.searchParams.get("skill");
  if (marker === "tree" && ref && rest.length > 0) {
    return {
      owner,
      repo: normalizeGitHubRepoName(repo),
      ref,
      packagePaths: [normalizeGitHubPath(rest.join("/"))],
    };
  }
  if (marker === "blob" && ref && rest.length > 0) {
    const filePath = normalizeGitHubPath(rest.join("/"));
    return {
      owner,
      repo: normalizeGitHubRepoName(repo),
      ref,
      packagePaths: [filePath.endsWith("/SKILL.md") ? path.posix.dirname(filePath) : filePath],
    };
  }
  if (skill) {
    const skillPath = normalizeGitHubPath(skill);
    return {
      owner,
      repo: normalizeGitHubRepoName(repo),
      ref: parsed.searchParams.get("ref") ?? "main",
      packagePaths: [`skills/${skillPath}`, `.agents/skills/${skillPath}`, skillPath],
    };
  }
  throw badRequest(
    "GitHub source URLs must point to a skill folder or include a skill query parameter.",
  );
}

function normalizePackagePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/gu, "/").replace(/^\.\/+/u, "");
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw badRequest("External skill package file paths must stay inside the package.");
  }
  return normalized;
}

function decodePackageFile(input: ExternalSkillPackageFileInput): Buffer {
  if (input.encoding === "base64") {
    return Buffer.from(input.content, "base64");
  }
  return Buffer.from(input.content, "utf8");
}

function toStoredPackageFile(
  input: ExternalSkillPackageFileInput,
): RuntimeSkillTemplatePackageFileRecord {
  const normalizedPath = normalizePackagePath(input.path);
  return {
    path: normalizedPath,
    content: decodePackageFile(input).toString("base64"),
    encoding: "base64",
  };
}

function packageFileText(
  files: RuntimeSkillTemplatePackageFileRecord[],
  filePath: string,
): string | null {
  const target = normalizePackagePath(filePath);
  const file = files.find((entry) => entry.path === target);
  return file ? Buffer.from(file.content, "base64").toString("utf8") : null;
}

function computePackageHash(files: RuntimeSkillTemplatePackageFileRecord[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(Buffer.from(file.content, "base64"));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function readManifest(files: RuntimeSkillTemplatePackageFileRecord[]): unknown | null {
  const text = packageFileText(files, "connector-capabilities.json");
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hasManifest(files: RuntimeSkillTemplatePackageFileRecord[]): boolean {
  return files.some((file) => file.path === "connector-capabilities.json");
}

function readSkillMetadata(skillMarkdown: string): {
  skillId: string | null;
  title: string | null;
  description: string | null;
} {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(skillMarkdown)?.[1] ?? "";
  const metadata = new Map<string, string>();
  for (const line of frontmatter.split(/\r?\n/u)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+)$/u.exec(line);
    if (match) {
      metadata.set(match[1].toLowerCase(), match[2].trim().replace(/^["']|["']$/gu, ""));
    }
  }
  const heading = /^#\s+(.+)$/mu.exec(skillMarkdown)?.[1]?.trim() ?? null;
  return {
    skillId: metadata.get("name") ?? null,
    title: metadata.get("display_name") ?? metadata.get("title") ?? heading,
    description: metadata.get("description") ?? null,
  };
}

function slugifySkillLabel(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['']/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function possibleDirectorySlugMatches(targetSlug: string, directorySlug: string): boolean {
  if (!directorySlug) {
    return false;
  }
  const candidates = new Set([directorySlug]);
  if (directorySlug.endsWith("s")) {
    candidates.add(directorySlug.slice(0, -1));
  }
  for (const candidate of candidates) {
    if (
      targetSlug === candidate ||
      targetSlug.startsWith(`${candidate}-`) ||
      targetSlug.endsWith(`-${candidate}`)
    ) {
      return true;
    }
  }
  return false;
}

function gitHubEntryName(entry: GitHubContentEntry): string {
  return entry.name ?? (entry.path ? path.posix.basename(entry.path) : "");
}

function skillDirectoryMatchScore(entry: GitHubContentEntry, targetSlug: string): number {
  const directorySlug = slugifySkillLabel(gitHubEntryName(entry));
  if (directorySlug === targetSlug) {
    return 3;
  }
  if (possibleDirectorySlugMatches(targetSlug, directorySlug)) {
    return 2;
  }
  if (directorySlug && (targetSlug.includes(directorySlug) || directorySlug.includes(targetSlug))) {
    return 1;
  }
  return 0;
}

function orderSkillDirectories(
  entries: GitHubContentEntry[],
  targetSlug: string,
): GitHubContentEntry[] {
  return [...entries].sort((left, right) => {
    const scoreDelta =
      skillDirectoryMatchScore(right, targetSlug) -
      skillDirectoryMatchScore(left, targetSlug);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return gitHubEntryName(left).localeCompare(gitHubEntryName(right));
  });
}

function sanitizeId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");
  return normalized || fallback;
}

function buildOpenAiYaml(input: {
  skillId: string;
  title: string;
  description: string | null;
}): string {
  return [
    `name: ${input.skillId}`,
    `description: ${input.description ?? input.title}`,
    "",
  ].join("\n");
}

function buildChecks(input: {
  files: RuntimeSkillTemplatePackageFileRecord[];
  manifest: unknown | null;
  manifestPresent: boolean;
  gate: ConnectorExecutionGateManifest | null;
  sourceKind: ExternalSkillSourceKind;
  sourceUrl: string | null;
  remoteFetched: boolean;
}): ExternalSkillPreviewCheck[] {
  const checks: ExternalSkillPreviewCheck[] = [];
  const paths = new Set(input.files.map((file) => file.path));
  checks.push(
    paths.has("SKILL.md")
      ? {
          id: "skill-md",
          status: "passed",
          message: "SKILL.md is present at the package root.",
        }
      : {
          id: "skill-md",
          status: "failed",
          message: "SKILL.md is required at the package root.",
        },
  );
  checks.push({
    id: "source",
    status:
      input.sourceKind === "upload" || input.sourceUrl ? "passed" : "warning",
    message:
      input.remoteFetched
        ? "Remote package source fetched."
        : input.sourceKind === "upload"
        ? "Uploaded package source recorded."
        : input.sourceUrl
          ? "Explicit external source URL recorded."
          : "External source URL was not provided.",
  });
  const secretFile = input.files.find((file) =>
    /(^|\/)(\.env|.*\.(?:pem|key|p12|pfx))$/iu.test(file.path),
  );
  if (secretFile) {
    checks.push({
      id: "secret-files",
      status: "failed",
      message: `Package must not include secret material: ${secretFile.path}`,
    });
  } else {
    checks.push({
      id: "secret-files",
      status: "passed",
      message: "No obvious secret files were included in the package.",
    });
  }
  if (!input.manifestPresent) {
    checks.push({
      id: "connector-manifest",
      status: "warning",
      message: "No connector-capabilities.json was found; this mounts as a general external skill only.",
    });
  } else if (!input.manifest) {
    checks.push({
      id: "connector-manifest",
      status: "warning",
      message: "connector-capabilities.json could not be parsed; credential injection is unavailable.",
    });
  } else {
    const blocked = input.gate?.capabilities.filter(
      (capability) => capability.credentialGateStatus === "blocked",
    ) ?? [];
    checks.push({
      id: "connector-manifest",
      status: blocked.length > 0 ? "warning" : "passed",
      message:
        blocked.length > 0
          ? `${blocked.length} connected capability cannot receive account credentials.`
          : "Connector manifest was normalized for preview.",
    });
  }
  return checks;
}

export class ExternalSkillService {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly skillTemplateStore: SkillTemplateStore;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ExternalSkillServiceOptions = {}) {
    this.stateRoot = resolveStateRoot(options.stateRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.skillTemplateStore =
      options.skillTemplateStore ??
      new SkillTemplateStore({
        stateRoot: this.stateRoot,
        now: this.now,
        idGenerator: this.idGenerator,
      });
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private get previewsRoot(): string {
    return path.join(this.stateRoot, "external-skill-previews");
  }

  private previewRoot(previewId: string): string {
    const id = sanitizeId(previewId, "preview");
    return path.join(this.previewsRoot, id);
  }

  async previewExternalSkill(
    input: ExternalSkillPreviewInput,
  ): Promise<ExternalSkillPreviewRecord> {
    const sourceKind = normalizeSourceKind(input.sourceKind);
    const sourceUrl = readSourceUrl(input.sourceUrl);
    const providedFiles = Array.isArray(input.files) ? input.files : [];
    const remoteFetched = providedFiles.length === 0;
    const rawFiles = remoteFetched
      ? await this.fetchRemotePackageFiles(sourceUrl)
      : providedFiles;

    const byPath = new Map<string, RuntimeSkillTemplatePackageFileRecord>();
    for (const rawFile of rawFiles) {
      byPath.set(normalizePackagePath(rawFile.path), toStoredPackageFile(rawFile));
    }
    const packageFiles = [...byPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const skillMarkdown = packageFileText(packageFiles, "SKILL.md") ?? "";
    const metadata = readSkillMetadata(skillMarkdown);
    const skillId = sanitizeId(
      metadata.skillId ?? metadata.title ?? "external-skill",
      "external-skill",
    );
    const title = metadata.title ?? skillId;
    const description = metadata.description;
    const manifestPresent = hasManifest(packageFiles);
    const manifest = readManifest(packageFiles);
    const gate = manifest
      ? normalizeConnectorExecutionGate({
          manifest,
          files: packageFiles.map((file) => ({
            path: file.path,
            content: Buffer.from(file.content, "base64").toString("utf8"),
          })),
          generatedAt: this.now(),
        })
      : null;
    const packageFilesWithGate = gate
      ? upsertPackageFile(packageFiles, {
          path: CONNECTOR_EXECUTION_GATE_FILE,
          content: Buffer.from(serializeJson(gate), "utf8").toString("base64"),
          encoding: "base64",
        })
      : packageFiles;
    const checks = buildChecks({
      files: packageFilesWithGate,
      manifest,
      manifestPresent,
      gate,
      sourceKind,
      sourceUrl,
      remoteFetched,
    });
    const preview: ExternalSkillPreviewRecord = {
      id: sanitizeId(this.idGenerator(), randomUUID()),
      sourceKind,
      sourceUrl,
      packageHash: computePackageHash(packageFilesWithGate),
      installable: checks.every((check) => check.status !== "failed"),
      skillId,
      title,
      description,
      fileCount: packageFilesWithGate.length,
      checks,
      capabilities:
        gate?.capabilities.map((capability) => ({
          id: capability.id,
          provider: capability.provider,
          action: capability.action,
          scriptPath: capability.scriptPath,
          requiresConnectedAccount: capability.requiresConnectedAccount,
          credentialGateStatus: capability.credentialGateStatus,
          reasons: capability.reasons,
        })) ?? [],
      createdAt: this.now(),
    };

    const previewRoot = this.previewRoot(preview.id);
    assertInside(this.previewsRoot, previewRoot);
    await mkdir(path.join(previewRoot, "package"), { recursive: true });
    for (const file of packageFilesWithGate) {
      const targetPath = path.join(previewRoot, "package", ...file.path.split("/"));
      assertInside(path.join(previewRoot, "package"), targetPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(file.content, "base64"));
    }
    await writeFile(
      path.join(previewRoot, "preview.json"),
      serializeJson({
        preview,
        packageFiles: packageFilesWithGate,
        gate,
        skillMarkdown,
      } satisfies StoredExternalSkillPreview),
      "utf8",
    );

    return preview;
  }

  private async fetchRemotePackageFiles(
    sourceUrl: string | null,
  ): Promise<ExternalSkillPackageFileInput[]> {
    if (!sourceUrl) {
      throw badRequest("External skill preview requires package files or a sourceUrl.");
    }
    const source = this.resolveRemoteGitHubSource(sourceUrl);
    let lastError: unknown = null;
    for (const packagePath of source.packagePaths) {
      try {
        return await this.fetchGitHubPackage({
          owner: source.owner,
          repo: source.repo,
          ref: source.ref,
          packagePath,
        });
      } catch (error) {
        lastError = error;
      }
    }
    if (source.skillsShSlug) {
      const packagePath = await this.findSkillsShPackagePath(source);
      if (packagePath) {
        try {
          return await this.fetchGitHubPackage({
            owner: source.owner,
            repo: source.repo,
            ref: source.ref,
            packagePath,
          });
        } catch (error) {
          lastError = error;
        }
      }
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw badRequest("Could not resolve an external skill package from sourceUrl.");
  }

  private resolveRemoteGitHubSource(sourceUrl: string): GitHubPackageSource {
    const source =
      parseSkillsShSourceUrl(sourceUrl) ?? parseGitHubSourceUrl(sourceUrl);
    if (!source) {
      throw badRequest("External skill sourceUrl must be a skills.sh or GitHub URL.");
    }
    return source;
  }

  private async findSkillsShPackagePath(
    source: GitHubPackageSource,
  ): Promise<string | null> {
    if (!source.skillsShSlug) {
      return null;
    }
    const targetSlug = slugifySkillLabel(source.skillsShSlug);
    let rootContent: GitHubContentEntry | GitHubContentEntry[];
    try {
      rootContent = await this.fetchGitHubContent({
        owner: source.owner,
        repo: source.repo,
        ref: source.ref,
        githubPath: "skills",
      });
    } catch {
      return null;
    }
    if (!Array.isArray(rootContent)) {
      return null;
    }

    const queue = orderSkillDirectories(
      rootContent.filter((entry) => entry.type === "dir" && entry.path),
      targetSlug,
    ).map((entry) => ({ entry, depth: 1 }));
    const seen = new Set<string>();
    let scannedDirectoryCount = 0;

    while (queue.length > 0 && scannedDirectoryCount < SKILLS_SH_DIRECTORY_SCAN_LIMIT) {
      const { entry: directory, depth } = queue.shift()!;
      const directoryPath = directory.path;
      if (!directoryPath) {
        continue;
      }
      if (seen.has(directoryPath)) {
        continue;
      }
      seen.add(directoryPath);
      scannedDirectoryCount += 1;

      if (await this.matchesSkillsShSkillDirectory(source, directory, targetSlug)) {
        return directoryPath;
      }

      if (depth >= SKILLS_SH_DIRECTORY_DEPTH_LIMIT) {
        continue;
      }

      let directoryContent: GitHubContentEntry | GitHubContentEntry[];
      try {
        directoryContent = await this.fetchGitHubContent({
          owner: source.owner,
          repo: source.repo,
          ref: source.ref,
          githubPath: directoryPath,
        });
      } catch {
        continue;
      }
      if (!Array.isArray(directoryContent)) {
        continue;
      }
      const childDirectories = orderSkillDirectories(
        directoryContent.filter((entry) => entry.type === "dir" && entry.path),
        targetSlug,
      ).map((entry) => ({ entry, depth: depth + 1 }));
      const likelyChildren = childDirectories.filter(
        ({ entry }) => skillDirectoryMatchScore(entry, targetSlug) > 0,
      );
      const otherChildren = childDirectories.filter(
        ({ entry }) => skillDirectoryMatchScore(entry, targetSlug) === 0,
      );
      queue.unshift(...likelyChildren);
      queue.push(...otherChildren);
    }
    return null;
  }

  private async matchesSkillsShSkillDirectory(
    source: GitHubPackageSource,
    directory: GitHubContentEntry,
    targetSlug: string,
  ): Promise<boolean> {
    const directoryPath = directory.path;
    if (!directoryPath) {
      return false;
    }
    try {
      const skillContent = await this.fetchGitHubContent({
        owner: source.owner,
        repo: source.repo,
        ref: source.ref,
        githubPath: `${directoryPath}/SKILL.md`,
      });
      const skillEntry = Array.isArray(skillContent) ? skillContent[0] : skillContent;
      const markdown = Buffer.from(await this.readGitHubFile(skillEntry)).toString(
        "utf8",
      );
      const metadata = readSkillMetadata(markdown);
      const candidateSlugs = [
        metadata.skillId,
        metadata.title,
        directory.name,
        path.posix.basename(directoryPath),
      ]
        .filter((value): value is string => Boolean(value))
        .map(slugifySkillLabel);
      return candidateSlugs.includes(targetSlug);
    } catch {
      // Keep scanning; not every directory is guaranteed to be a valid skill.
      return false;
    }
  }

  private async fetchGitHubPackage(input: {
    owner: string;
    repo: string;
    ref: string;
    packagePath: string;
  }): Promise<ExternalSkillPackageFileInput[]> {
    const rootPath = normalizeGitHubPath(input.packagePath);
    const files: ExternalSkillPackageFileInput[] = [];
    let totalBytes = 0;

    const visit = async (githubPath: string): Promise<void> => {
      const content = await this.fetchGitHubContent({
        owner: input.owner,
        repo: input.repo,
        ref: input.ref,
        githubPath,
      });
      const entries = Array.isArray(content) ? content : [content];
      for (const entry of entries) {
        if (entry.type === "dir" && entry.path) {
          await visit(entry.path);
          continue;
        }
        if (entry.type !== "file" || !entry.path) {
          continue;
        }
        const contentBytes = await this.readGitHubFile(entry);
        totalBytes += contentBytes.byteLength;
        if (files.length >= REMOTE_PACKAGE_FILE_LIMIT) {
          throw badRequest("Remote skill package has too many files.");
        }
        if (totalBytes > REMOTE_PACKAGE_BYTE_LIMIT) {
          throw badRequest("Remote skill package is too large.");
        }
        files.push({
          path: relativePackagePath(entry.path, rootPath),
          content: Buffer.from(contentBytes).toString("base64"),
          encoding: "base64",
        });
      }
    };

    await visit(rootPath);
    if (!files.some((file) => file.path === "SKILL.md")) {
      throw badRequest("Remote skill package does not contain SKILL.md at its root.");
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async fetchGitHubContent(input: {
    owner: string;
    repo: string;
    ref: string;
    githubPath: string;
  }): Promise<GitHubContentEntry | GitHubContentEntry[]> {
    const pathPart = input.githubPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(
      input.owner,
    )}/${encodeURIComponent(input.repo)}/contents/${pathPart}?ref=${encodeURIComponent(
      input.ref,
    )}`;
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Rocky external skill preview",
      },
    });
    if (!response.ok) {
      throw badRequest(
        `Could not fetch GitHub skill package path ${input.githubPath} (${response.status}).`,
      );
    }
    return (await response.json()) as GitHubContentEntry | GitHubContentEntry[];
  }

  private async readGitHubFile(entry: GitHubContentEntry): Promise<Uint8Array> {
    if (entry.content && entry.encoding === "base64") {
      return Buffer.from(entry.content.replace(/\s/gu, ""), "base64");
    }
    if (!entry.download_url) {
      throw badRequest(`GitHub file is missing a download URL: ${entry.path ?? "unknown"}`);
    }
    const response = await this.fetchImpl(entry.download_url, {
      headers: {
        "User-Agent": "Rocky external skill preview",
      },
    });
    if (!response.ok) {
      throw badRequest(`Could not download GitHub file ${entry.path ?? "unknown"}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async mountExternalSkill(previewId: string): Promise<ExternalSkillMountResult> {
    const stored = await this.readPreview(previewId);
    if (!stored.preview.installable) {
      throw badRequest("External skill preview did not pass package checks.");
    }

    const mountedAt = this.now();
    const recordId = `external.${stored.preview.skillId}`;
    const skillRecord: RuntimeSkillTemplateRecord = {
      id: recordId,
      source: "user",
      category: "content",
      title: stored.preview.title,
      description:
        stored.preview.description ??
        "Mounted external public skill package.",
      triggerLabel: "External skill",
      requiredInputs: [],
      outputFormatLabel: "Skill package",
      defaultInstructions:
        stored.preview.description ??
        "Use the mounted external public skill package.",
      skill: {
        id: stored.preview.skillId,
        displayName: stored.preview.title,
        description:
          stored.preview.description ??
          "Mounted external public skill package.",
        invocation: `$${stored.preview.skillId}`,
        skillMarkdown: stored.skillMarkdown,
        openAiYaml: buildOpenAiYaml({
          skillId: stored.preview.skillId,
          title: stored.preview.title,
          description: stored.preview.description,
        }),
        syncStatus: "local",
        workspacePath: null,
      },
      sortOrder: 0,
      createdAt: mountedAt,
      updatedAt: mountedAt,
      packageFiles: stored.packageFiles,
      externalSkill: {
        sourceKind: stored.preview.sourceKind,
        sourceUrl: stored.preview.sourceUrl,
        packageHash: stored.preview.packageHash,
        previewId: stored.preview.id,
        mountedAt,
      },
    };
    const skill = await this.skillTemplateStore.upsertSkill(skillRecord);
    return {
      preview: stored.preview,
      skill,
    };
  }

  private async readPreview(previewId: string): Promise<StoredExternalSkillPreview> {
    const previewRoot = this.previewRoot(previewId);
    const previewPath = path.join(previewRoot, "preview.json");
    if (!(await exists(previewPath))) {
      throw notFound(`Unknown external skill preview: ${previewId}`);
    }
    return JSON.parse(await readFile(previewPath, "utf8")) as StoredExternalSkillPreview;
  }
}

function upsertPackageFile(
  files: RuntimeSkillTemplatePackageFileRecord[],
  file: RuntimeSkillTemplatePackageFileRecord,
): RuntimeSkillTemplatePackageFileRecord[] {
  return [
    ...files.filter((entry) => entry.path !== file.path),
    file,
  ].sort((left, right) => left.path.localeCompare(right.path));
}

function relativePackagePath(githubPath: string, rootPath: string): string {
  const normalizedPath = normalizeGitHubPath(githubPath);
  const normalizedRoot = normalizeGitHubPath(rootPath);
  const relative =
    normalizedPath === normalizedRoot
      ? path.posix.basename(normalizedPath)
      : normalizedPath.slice(normalizedRoot.length).replace(/^\/+/u, "");
  return normalizePackagePath(relative);
}
