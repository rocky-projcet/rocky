import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { CodexCliRuntime } from "./codex-cli-runtime.js";
import { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { OllamaRuntime } from "./ollama-runtime.js";
import { resolveCodexBin } from "./codex-bin-resolver.js";
import { resolveClaudeCodeBin } from "./claude-code-bin-resolver.js";
import { resolveOllamaBin } from "./ollama-bin-resolver.js";
import { OllamaModelCatalog } from "./ollama-model-catalog.js";

import type { RuntimeAdapter } from "./runtime-adapter.js";
import type {
  RuntimeKind,
  RuntimeModelOption,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "./runtime-types.js";
import type { RuntimeDescriptorRecord } from "../api/api-types.js";

export interface RuntimeRegistryEntry {
  kind: RuntimeKind;
  label: string;
  provider: RuntimeModelOption["provider"];
  adapter: RuntimeAdapter;
  listDescriptor(): Promise<RuntimeDescriptorRecord>;
  resolveBin(
    requestedBin: string | undefined,
    env?: NodeJS.ProcessEnv
  ): Promise<string>;
}

const CODEX_REASONING_EFFORTS: RuntimeReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];

const CODEX_SERVICE_TIERS: RuntimeServiceTier[] = ["fast"];
const CLAUDE_REASONING_EFFORTS: RuntimeReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "max",
];

interface CodexModelCacheRecord {
  slug?: unknown;
  display_name?: unknown;
  visibility?: unknown;
  priority?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
  additional_speed_tiers?: unknown;
}

interface CodexModelCache {
  models?: unknown;
}

function isRuntimeReasoningEffort(value: unknown): value is RuntimeReasoningEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function isRuntimeServiceTier(value: unknown): value is RuntimeServiceTier {
  return value === "fast";
}

function resolveCodexHome(baseEnv: NodeJS.ProcessEnv): string {
  const explicitCodexHome = baseEnv.CODEX_HOME?.trim();
  if (explicitCodexHome) {
    return path.resolve(explicitCodexHome);
  }

  return path.join(path.resolve(baseEnv.HOME ?? os.homedir()), ".codex");
}

function parseConfiguredCodexModel(configToml: string): string | null {
  const match = /^\s*model\s*=\s*"([^"]+)"\s*$/mu.exec(configToml);
  return match?.[1]?.trim() || null;
}

function parseCodexReasoningEfforts(
  supportedReasoningLevels: unknown,
  fallback: RuntimeReasoningEffort[]
): RuntimeReasoningEffort[] {
  if (!Array.isArray(supportedReasoningLevels)) {
    return fallback;
  }

  const efforts = supportedReasoningLevels
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as { effort?: unknown }).effort
        : entry
    )
    .filter(isRuntimeReasoningEffort);

  return [...new Set(efforts)].length > 0 ? [...new Set(efforts)] : fallback;
}

function parseCodexServiceTiers(value: unknown): RuntimeServiceTier[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(isRuntimeServiceTier))];
}

function buildCodexModelOption(
  id: string,
  label: string,
  options: {
    defaultReasoningEffort?: RuntimeReasoningEffort | null;
    supportedReasoningEfforts?: RuntimeReasoningEffort[];
    supportedServiceTiers?: RuntimeServiceTier[];
  } = {}
): RuntimeModelOption {
  return {
    id,
    label,
    provider: "codex",
    supportedReasoningEfforts:
      options.supportedReasoningEfforts ?? CODEX_REASONING_EFFORTS,
    defaultReasoningEffort: options.defaultReasoningEffort ?? "medium",
    supportedServiceTiers: options.supportedServiceTiers ?? [],
    defaultServiceTier: null,
  };
}

const FALLBACK_CODEX_MODEL_OPTIONS: RuntimeModelOption[] = [
  buildCodexModelOption("gpt-5.5", "GPT-5.5", {
    supportedServiceTiers: CODEX_SERVICE_TIERS,
  }),
  buildCodexModelOption("gpt-5.4", "gpt-5.4", {
    supportedServiceTiers: CODEX_SERVICE_TIERS,
  }),
  buildCodexModelOption("gpt-5.4-mini", "GPT-5.4-Mini"),
  buildCodexModelOption("gpt-5.3-codex", "gpt-5.3-codex"),
  buildCodexModelOption("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark", {
    defaultReasoningEffort: "high",
  }),
  buildCodexModelOption("gpt-5.2", "gpt-5.2"),
];

const CLAUDE_MODEL_OPTIONS: RuntimeModelOption[] = [
  {
    id: "default",
    label: "Default (recommended) · Sonnet 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "sonnet[1m]",
    label: "Sonnet (1M context) · Sonnet 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "opus",
    label: "Opus · Opus 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "opus[1m]",
    label: "Opus (1M context) · Opus 4.6",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
  {
    id: "haiku",
    label: "Haiku · Haiku 4.5",
    provider: "claude",
    supportedReasoningEfforts: CLAUDE_REASONING_EFFORTS,
    defaultReasoningEffort: null,
    supportedServiceTiers: [],
    defaultServiceTier: null,
  },
];

function modelOptionFromCodexCacheRecord(
  record: CodexModelCacheRecord
): { option: RuntimeModelOption; priority: number } | null {
  if (record.visibility !== "list") {
    return null;
  }

  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  if (!slug) {
    return null;
  }

  const supportedReasoningEfforts = parseCodexReasoningEfforts(
    record.supported_reasoning_levels,
    CODEX_REASONING_EFFORTS
  );
  const defaultReasoningEffort = isRuntimeReasoningEffort(
    record.default_reasoning_level
  )
    ? record.default_reasoning_level
    : supportedReasoningEfforts[0] ?? null;

  return {
    option: buildCodexModelOption(
      slug,
      typeof record.display_name === "string" && record.display_name.trim()
        ? record.display_name.trim()
        : slug,
      {
        defaultReasoningEffort,
        supportedReasoningEfforts,
        supportedServiceTiers: parseCodexServiceTiers(
          record.additional_speed_tiers
        ),
      }
    ),
    priority:
      typeof record.priority === "number" && Number.isFinite(record.priority)
        ? record.priority
        : Number.MAX_SAFE_INTEGER,
  };
}

async function readCodexModelsCache(
  codexHome: string
): Promise<CodexModelCache | null> {
  try {
    const raw = await readFile(path.join(codexHome, "models_cache.json"), "utf8");
    return JSON.parse(raw) as CodexModelCache;
  } catch {
    return null;
  }
}

async function readConfiguredDefaultCodexModel(
  codexHome: string
): Promise<string | null> {
  try {
    return parseConfiguredCodexModel(
      await readFile(path.join(codexHome, "config.toml"), "utf8")
    );
  } catch {
    return null;
  }
}

async function buildCodexRuntimeDescriptor(
  baseEnv: NodeJS.ProcessEnv
): Promise<RuntimeDescriptorRecord> {
  const codexHome = resolveCodexHome(baseEnv);
  const cache = await readCodexModelsCache(codexHome);
  const cachedOptions = Array.isArray(cache?.models)
    ? cache.models
        .map((record) =>
          record && typeof record === "object"
            ? modelOptionFromCodexCacheRecord(record as CodexModelCacheRecord)
            : null
        )
        .filter(
          (entry): entry is { option: RuntimeModelOption; priority: number } =>
            entry !== null
        )
        .sort((left, right) => left.priority - right.priority)
        .map((entry) => entry.option)
    : [];
  const modelOptions =
    cachedOptions.length > 0 ? cachedOptions : FALLBACK_CODEX_MODEL_OPTIONS;
  const configuredDefaultModel = await readConfiguredDefaultCodexModel(codexHome);
  const defaultModel =
    configuredDefaultModel &&
    modelOptions.some((option) => option.id === configuredDefaultModel)
      ? configuredDefaultModel
      : modelOptions[0]?.id ?? null;

  return {
    kind: "codex-cli",
    label: "Codex CLI",
    provider: "codex",
    defaultModel,
    modelOptions,
  };
}

export class RuntimeRegistry {
  private readonly entries = new Map<RuntimeKind, RuntimeRegistryEntry>();

  constructor(entries: RuntimeRegistryEntry[]) {
    for (const entry of entries) {
      this.entries.set(entry.kind, entry);
    }
  }

  get(kind: RuntimeKind): RuntimeRegistryEntry {
    const entry = this.entries.get(kind);
    if (!entry) {
      throw new Error(`Unknown runtime kind: ${kind}`);
    }

    return entry;
  }

  async list(): Promise<RuntimeDescriptorRecord[]> {
    return Promise.all(
      [...this.entries.values()].map((entry) => entry.listDescriptor())
    );
  }
}

export function createDefaultRuntimeRegistry(
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: {
    ollamaCatalog?: OllamaModelCatalog;
  } = {}
): RuntimeRegistry {
  const ollamaCatalog = options.ollamaCatalog ?? new OllamaModelCatalog();

  return new RuntimeRegistry([
    {
      kind: "codex-cli",
      label: "Codex CLI",
      provider: "codex",
      adapter: new CodexCliRuntime({
        baseEnv,
      }),
      listDescriptor: async () => buildCodexRuntimeDescriptor(baseEnv),
      resolveBin: (requestedBin, env = baseEnv) => resolveCodexBin(requestedBin, env),
    },
    {
      kind: "claude-code",
      label: "Claude Code",
      provider: "claude",
      adapter: new ClaudeCodeRuntime({
        baseEnv,
      }),
      listDescriptor: async () => ({
        kind: "claude-code",
        label: "Claude Code",
        provider: "claude",
        defaultModel: "default",
        modelOptions: CLAUDE_MODEL_OPTIONS,
      }),
      resolveBin: (requestedBin, env = baseEnv) => resolveClaudeCodeBin(requestedBin, env),
    },
    {
      kind: "ollama",
      label: "Ollama",
      provider: "ollama",
      adapter: new OllamaRuntime({
        baseEnv,
        catalog: ollamaCatalog,
      }),
      listDescriptor: async () => ollamaCatalog.buildRuntimeDescriptor(),
      resolveBin: (requestedBin, env = baseEnv) => resolveOllamaBin(requestedBin, env),
    },
  ]);
}
