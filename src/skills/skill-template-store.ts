import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface RuntimeSkillTemplateRecord {
  id: string;
  source: "builtin" | "user";
  category: "document" | "content" | "data";
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  inputFiles?: string[];
  inputArtifacts?: RuntimeSkillTemplateInputArtifactRecord[];
  sourceRunId?: string | null;
  outputFormatLabel: string;
  outputFiles?: string[];
  defaultInstructions: string;
  skill: {
    id: string;
    displayName: string;
    description: string;
    invocation: string;
    skillMarkdown: string;
    openAiYaml: string;
    syncStatus: "local" | "syncing" | "synced" | "failed";
    workspacePath: string | null;
    lastSyncedAt?: string;
    lastSyncError?: string;
  };
  sortOrder: number;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  packageFiles?: RuntimeSkillTemplatePackageFileRecord[];
  externalSkill?: RuntimeExternalSkillMetadataRecord;
}

export interface RuntimeSkillTemplateInputArtifactRecord {
  id: string;
  runId: string;
  fieldId: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
  runtimePath: string;
  skillPath?: string | null;
  uploadedAt: string;
}

export interface RuntimeSkillTemplatePackageFileRecord {
  path: string;
  content: string;
  encoding: "base64";
}

export interface RuntimeExternalSkillMetadataRecord {
  sourceKind: "mcp-market" | "github" | "upload";
  sourceUrl: string | null;
  packageHash: string;
  previewId?: string;
  mountedAt: string;
}

export interface SkillTemplateRunRecord {
  id: string;
  templateKind: string | null;
  status: "draft" | "completed";
  createdAt: string;
  updatedAt: string;
}

export interface SkillTemplateRunUploadInput {
  fieldId?: string | null;
  fileName: string;
  contentType?: string | null;
  size?: number | null;
  contentBase64: string;
}

export interface SkillTemplateStoreOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
}

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
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
  );
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "");

  return sanitized || fallback;
}

function assertRecordId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest(`${label} must be a non-empty string.`);
  }
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    throw badRequest(`${label} must be a single path segment.`);
  }
  if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) {
    throw badRequest(`${label} may only contain letters, numbers, dots, underscores, or hyphens.`);
  }
  return normalized;
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

function markdownCode(value: string): string {
  return `\`${value.replace(/`/gu, "\\`")}\``;
}

function formatPackagedInputFilesSection(
  artifacts: RuntimeSkillTemplateInputArtifactRecord[]
): string | null {
  const packagedArtifacts = artifacts.filter(
    (artifact) => typeof artifact.skillPath === "string" && artifact.skillPath.trim()
  );
  if (packagedArtifacts.length === 0) {
    return null;
  }

  return [
    "## Packaged Input Files",
    "Paths are relative to this skill directory and are already available inputs.",
    ...packagedArtifacts.map(
      (artifact) =>
        `- ${artifact.fileName}: ${markdownCode(artifact.skillPath!)}`
    ),
    "",
    "",
  ].join("\n");
}

function withPackagedInputFilesSection(
  record: RuntimeSkillTemplateRecord
): RuntimeSkillTemplateRecord {
  const section = formatPackagedInputFilesSection(record.inputArtifacts ?? []);
  if (!section) {
    return record;
  }

  const markdownWithoutExistingSection = record.skill.skillMarkdown
    .replace(
      /\n## Packaged Input Files\n[\s\S]*?(?=\n## |\s*$)/u,
      "\n"
    )
    .replace(/\n{3,}/gu, "\n\n");
  const workflowHeading = "\n## Workflow\n";
  const skillMarkdown = markdownWithoutExistingSection.includes(workflowHeading)
    ? markdownWithoutExistingSection.replace(
        workflowHeading,
        `\n${section}## Workflow\n`
      )
    : `${markdownWithoutExistingSection.trimEnd()}\n\n${section}`;

  return {
    ...record,
    skill: {
      ...record.skill,
      skillMarkdown,
    },
  };
}

function requiresPdfOutput(value: string): boolean {
  return value.toLowerCase().includes("pdf");
}

function formatOutputDirectorySection(outputFormatLabel: string): string {
  const lines = [
    "## Output Directory Rules",
    "- Create every final deliverable file under `outputs/` in the current workspace. Do not place final deliverables in the workspace root or other folders.",
    "- Create `outputs/` before writing files, and verify the expected files exist there before the final response.",
    "- In the final response, list each deliverable with its `outputs/...` path.",
  ];

  if (requiresPdfOutput(outputFormatLabel)) {
    lines.push(
      "- For PDF deliverables, first create a self-contained HTML source file in `outputs/`, then generate the PDF from that exact HTML source. Keep both files in `outputs/`.",
      "- Use a browser rendering engine for HTML-to-PDF whenever available, such as Playwright, Puppeteer, or Chromium with `printBackground: true` and `preferCSSPageSize: true`, so CSS, fonts, backgrounds, tables, and page breaks are preserved.",
      "- Do not replace browser rendering with text-only or manual PDF libraries such as PyMuPDF, ReportLab, or fpdf when the HTML styling matters. If no browser-capable renderer is available, leave the HTML source, explain the blocker, and do not claim the PDF preserves the HTML styling."
    );
  }

  return `${lines.join("\n")}\n\n`;
}

function withOutputDirectorySection(
  record: RuntimeSkillTemplateRecord
): RuntimeSkillTemplateRecord {
  const markdownWithoutExistingSection = record.skill.skillMarkdown
    .replace(
      /\n## Output Directory Rules\n[\s\S]*?(?=\n## |\s*$)/u,
      "\n"
    )
    .replace(/\n{3,}/gu, "\n\n");
  const qualityHeading = "\n## Quality Rules\n";
  const section = formatOutputDirectorySection(record.outputFormatLabel);
  const skillMarkdown = markdownWithoutExistingSection.includes(qualityHeading)
    ? markdownWithoutExistingSection.replace(
        qualityHeading,
        `\n${section}## Quality Rules\n`
      )
    : `${markdownWithoutExistingSection.trimEnd()}\n\n${section}`;

  return {
    ...record,
    skill: {
      ...record.skill,
      skillMarkdown,
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parsePackageFiles(value: unknown): RuntimeSkillTemplatePackageFileRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter((entry): entry is RuntimeSkillTemplatePackageFileRecord => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      const record = entry as Partial<RuntimeSkillTemplatePackageFileRecord>;
      return (
        typeof record.path === "string" &&
        typeof record.content === "string" &&
        record.encoding === "base64"
      );
    })
    .map((entry) => ({
      path: entry.path,
      content: entry.content,
      encoding: "base64",
    }));
}

function parseSkillTemplateRecord(value: unknown): RuntimeSkillTemplateRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Skill template must be a JSON object.");
  }

  const record = value as Partial<RuntimeSkillTemplateRecord>;
  if (typeof record.id !== "string") {
    throw badRequest("Skill template id is required.");
  }
  const id = assertRecordId(record.id, "Skill template id");
  if (record.source !== "user" && record.source !== "builtin") {
    throw badRequest("Skill template source must be user or builtin.");
  }
  if (
    record.category !== "document" &&
    record.category !== "content" &&
    record.category !== "data"
  ) {
    throw badRequest("Skill template category must be document, content, or data.");
  }
  if (
    typeof record.title !== "string" ||
    typeof record.description !== "string" ||
    typeof record.triggerLabel !== "string" ||
    typeof record.outputFormatLabel !== "string" ||
    typeof record.defaultInstructions !== "string"
  ) {
    throw badRequest("Skill template requires title, description, triggerLabel, outputFormatLabel, and defaultInstructions.");
  }
  if (!isStringArray(record.requiredInputs)) {
    throw badRequest("Skill template requiredInputs must be a string array.");
  }
  if (!record.skill || typeof record.skill !== "object") {
    throw badRequest("Skill template requires a generated skill object.");
  }
  const skill = record.skill as RuntimeSkillTemplateRecord["skill"];
  if (
    typeof skill.id !== "string" ||
    typeof skill.displayName !== "string" ||
    typeof skill.description !== "string" ||
    typeof skill.invocation !== "string" ||
    typeof skill.skillMarkdown !== "string" ||
    typeof skill.openAiYaml !== "string"
  ) {
    throw badRequest("Generated skill requires id, displayName, description, invocation, skillMarkdown, and openAiYaml.");
  }

  assertRecordId(skill.id, "Generated skill id");

  return {
    ...record,
    id,
    source: record.source,
    category: record.category,
    title: record.title,
    description: record.description,
    triggerLabel: record.triggerLabel,
    requiredInputs: record.requiredInputs,
    outputFormatLabel: record.outputFormatLabel,
    defaultInstructions: record.defaultInstructions,
    skill: {
      ...skill,
      workspacePath: skill.workspacePath ?? null,
      syncStatus: skill.syncStatus ?? "local",
    },
    sortOrder:
      typeof record.sortOrder === "number" && Number.isFinite(record.sortOrder)
        ? record.sortOrder
        : 0,
    sourceRunId:
      typeof record.sourceRunId === "string" && record.sourceRunId.trim()
        ? record.sourceRunId.trim()
        : null,
    packageFiles: parsePackageFiles(record.packageFiles),
    externalSkill:
      record.externalSkill &&
      typeof record.externalSkill === "object" &&
      !Array.isArray(record.externalSkill)
        ? (record.externalSkill as RuntimeExternalSkillMetadataRecord)
        : undefined,
  };
}

function parseRunRecord(value: unknown): SkillTemplateRunRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<SkillTemplateRunRecord>;
  if (typeof record.id !== "string" || typeof record.createdAt !== "string") {
    return null;
  }

  return {
    id: record.id,
    templateKind:
      typeof record.templateKind === "string" && record.templateKind.trim()
        ? record.templateKind.trim()
        : null,
    status: record.status === "completed" ? "completed" : "draft",
    createdAt: record.createdAt,
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt : record.createdAt,
  };
}

export class SkillTemplateStore {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly idGenerator: () => string;

  constructor(options: SkillTemplateStoreOptions = {}) {
    this.stateRoot = resolveStateRoot(options.stateRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  private get skillsRoot(): string {
    return path.join(this.stateRoot, "skills");
  }

  private get runsRoot(): string {
    return path.join(this.stateRoot, "skill-template-runs");
  }

  private skillRoot(skillRecordId: string): string {
    const id = assertRecordId(skillRecordId, "Skill template id");
    return path.join(this.skillsRoot, id);
  }

  private runRoot(runId: string): string {
    const id = assertRecordId(runId, "Skill template run id");
    return path.join(this.runsRoot, id);
  }

  private async packageInputArtifacts(
    record: RuntimeSkillTemplateRecord,
    skillRoot: string
  ): Promise<RuntimeSkillTemplateRecord> {
    const artifacts = record.inputArtifacts ?? [];
    if (artifacts.length === 0) {
      return record;
    }

    const filesRoot = path.join(skillRoot, "files");
    const packagedArtifacts: RuntimeSkillTemplateInputArtifactRecord[] = [];

    for (const artifact of artifacts) {
      const fieldId = sanitizePathSegment(artifact.fieldId, "general");
      const uploadId = assertRecordId(artifact.id, "Upload id");
      const fileName = sanitizePathSegment(artifact.fileName, "upload.bin");
      const skillPath = path.posix.join(
        "assets",
        "inputs",
        fieldId,
        uploadId,
        fileName
      );
      const destinationPath = path.join(filesRoot, ...skillPath.split("/"));
      assertInside(filesRoot, destinationPath);

      const sourcePath = path.join(
        this.stateRoot,
        ...artifact.runtimePath.split("/")
      );
      assertInside(this.stateRoot, sourcePath);

      if (await exists(sourcePath)) {
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await cp(sourcePath, destinationPath, {
          force: true,
          errorOnExist: false,
        });
      }

      packagedArtifacts.push({
        ...artifact,
        fieldId,
        fileName,
        skillPath,
      });
    }

    return {
      ...record,
      inputFiles:
        record.inputFiles ?? packagedArtifacts.map((artifact) => artifact.fileName),
      inputArtifacts: packagedArtifacts,
    };
  }

  private async writeSkillPackage(
    record: RuntimeSkillTemplateRecord,
    skillRoot: string
  ): Promise<RuntimeSkillTemplateRecord> {
    const filesRoot = path.join(skillRoot, "files");
    if (record.packageFiles && record.packageFiles.length > 0) {
      await rm(filesRoot, { recursive: true, force: true });
    }
    await mkdir(path.join(filesRoot, "agents"), { recursive: true });
    const packagedRecord = withPackagedInputFilesSection(
      await this.packageInputArtifacts(withOutputDirectorySection(record), skillRoot)
    );

    if (packagedRecord.packageFiles && packagedRecord.packageFiles.length > 0) {
      await this.writeStoredPackageFiles(packagedRecord.packageFiles, filesRoot);
      await mkdir(path.join(filesRoot, "agents"), { recursive: true });
    }

    await writeFile(path.join(skillRoot, "skill.json"), serializeJson(packagedRecord), "utf8");
    await writeFile(
      path.join(filesRoot, "SKILL.md"),
      packagedRecord.skill.skillMarkdown,
      "utf8"
    );
    await writeFile(
      path.join(filesRoot, "agents", "openai.yaml"),
      packagedRecord.skill.openAiYaml,
      "utf8"
    );

    return packagedRecord;
  }

  private async writeStoredPackageFiles(
    files: RuntimeSkillTemplatePackageFileRecord[],
    filesRoot: string
  ): Promise<void> {
    for (const file of files) {
      const normalized = file.path.trim().replace(/\\/gu, "/");
      if (
        !normalized ||
        path.isAbsolute(normalized) ||
        normalized.includes("\0") ||
        normalized.split("/").some((segment) => segment === "..")
      ) {
        throw badRequest("Stored skill package file path must stay inside the package.");
      }
      const targetPath = path.join(filesRoot, ...normalized.split("/"));
      assertInside(filesRoot, targetPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(file.content, "base64"));
    }
  }

  private async collectPackageFiles(
    rootPath: string,
    currentPath: string = rootPath
  ): Promise<RuntimeSkillTemplatePackageFileRecord[]> {
    if (!(await exists(currentPath))) {
      return [];
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    const files: RuntimeSkillTemplatePackageFileRecord[] = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".DS_Store") {
        continue;
      }

      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await this.collectPackageFiles(rootPath, entryPath));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");
      files.push({
        path: relativePath,
        content: (await readFile(entryPath)).toString("base64"),
        encoding: "base64",
      });
    }

    return files;
  }

  async listSkills(): Promise<RuntimeSkillTemplateRecord[]> {
    if (!(await exists(this.skillsRoot))) {
      return [];
    }

    const entries = await readdir(this.skillsRoot, { withFileTypes: true });
    const records: RuntimeSkillTemplateRecord[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) {
        continue;
      }

      const recordPath = path.join(this.skillsRoot, entry.name, "skill.json");
      try {
        records.push(parseSkillTemplateRecord(JSON.parse(await readFile(recordPath, "utf8"))));
      } catch {
        // Ignore malformed local runtime records instead of breaking the inventory.
      }
    }

    return records.sort((left, right) =>
      (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
    );
  }

  async upsertSkill(recordInput: unknown): Promise<RuntimeSkillTemplateRecord> {
    const record = parseSkillTemplateRecord(recordInput);
    const skillRoot = this.skillRoot(record.id);
    assertInside(this.skillsRoot, skillRoot);

    return this.writeSkillPackage(record, skillRoot);
  }

  async getSkillFiles(skillRecordId: string): Promise<RuntimeSkillTemplatePackageFileRecord[]> {
    const id = assertRecordId(skillRecordId, "Skill template id");
    const skillRoot = this.skillRoot(id);
    const filesRoot = path.join(skillRoot, "files");
    assertInside(this.skillsRoot, filesRoot);

    const recordPath = path.join(skillRoot, "skill.json");
    if (!(await exists(recordPath))) {
      throw notFound(`Unknown skill template files: ${id}`);
    }

    const record = parseSkillTemplateRecord(JSON.parse(await readFile(recordPath, "utf8")));
    await this.writeSkillPackage(record, skillRoot);

    return this.collectPackageFiles(filesRoot);
  }

  async deleteSkill(skillRecordId: string): Promise<{ id: string; deleted: boolean }> {
    const id = assertRecordId(skillRecordId, "Skill template id");
    const skillRoot = this.skillRoot(id);
    assertInside(this.skillsRoot, skillRoot);

    if (!(await exists(skillRoot))) {
      throw notFound(`Unknown skill template: ${id}`);
    }

    await rm(skillRoot, { recursive: true, force: false });
    return { id, deleted: true };
  }

  async createRun(input: { templateKind?: string | null } = {}): Promise<SkillTemplateRunRecord> {
    const timestamp = this.now();
    const id = assertRecordId(this.idGenerator(), "Skill template run id");
    const run: SkillTemplateRunRecord = {
      id,
      templateKind:
        typeof input.templateKind === "string" && input.templateKind.trim()
          ? input.templateKind.trim()
          : null,
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const runRoot = this.runRoot(id);
    assertInside(this.runsRoot, runRoot);
    await mkdir(runRoot, { recursive: true });
    await writeFile(path.join(runRoot, "run.json"), serializeJson(run), "utf8");
    return run;
  }

  async getRun(runId: string): Promise<SkillTemplateRunRecord> {
    const id = assertRecordId(runId, "Skill template run id");
    const runRoot = this.runRoot(id);
    const runPath = path.join(runRoot, "run.json");
    try {
      const run = parseRunRecord(JSON.parse(await readFile(runPath, "utf8")));
      if (run) {
        return run;
      }
    } catch {
      // handled below
    }

    throw notFound(`Unknown skill template run: ${id}`);
  }

  async uploadRunFile(
    runId: string,
    input: SkillTemplateRunUploadInput
  ): Promise<RuntimeSkillTemplateInputArtifactRecord> {
    const run = await this.getRun(runId);
    if (typeof input.fileName !== "string" || !input.fileName.trim()) {
      throw badRequest("Upload fileName is required.");
    }
    if (typeof input.contentBase64 !== "string") {
      throw badRequest("Upload contentBase64 is required.");
    }

    const fieldId = sanitizePathSegment(input.fieldId ?? "general", "general");
    const uploadId = assertRecordId(this.idGenerator(), "Upload id");
    const safeName = sanitizePathSegment(input.fileName, "upload.bin");
    const uploadRelativePath = path.posix.join(
      "skill-template-runs",
      run.id,
      "inputs",
      fieldId,
      uploadId,
      safeName
    );
    const uploadPath = path.join(
      this.stateRoot,
      ...uploadRelativePath.split("/")
    );
    assertInside(this.stateRoot, uploadPath);

    const body = Buffer.from(input.contentBase64, "base64");
    const uploadedAt = this.now();
    const artifact: RuntimeSkillTemplateInputArtifactRecord = {
      id: uploadId,
      runId: run.id,
      fieldId,
      fileName: safeName,
      contentType:
        typeof input.contentType === "string" && input.contentType.trim()
          ? input.contentType.trim()
          : null,
      size:
        typeof input.size === "number" && Number.isFinite(input.size)
          ? input.size
          : body.byteLength,
      runtimePath: uploadRelativePath,
      skillPath: null,
      uploadedAt,
    };

    await mkdir(path.dirname(uploadPath), { recursive: true });
    await writeFile(uploadPath, body);
    await writeFile(
      path.join(path.dirname(uploadPath), "metadata.json"),
      serializeJson(artifact),
      "utf8"
    );
    await writeFile(
      path.join(this.runRoot(run.id), "run.json"),
      serializeJson({ ...run, updatedAt: uploadedAt }),
      "utf8"
    );

    return artifact;
  }
}
