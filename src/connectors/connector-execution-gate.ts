import path from "node:path";

import { listSupportedProviders } from "./adapters.js";
import type {
  ConnectorCapabilityAction,
  ConnectorProvider,
} from "./connector-types.js";

export const CONNECTOR_EXECUTION_GATE_FILE = "connector-execution-gate.json";

export type ConnectorCredentialGateStatus =
  | "not-required"
  | "allowed"
  | "blocked";

export interface ConnectorExecutionGateCapability {
  id: string;
  provider: ConnectorProvider;
  action: ConnectorCapabilityAction;
  scriptPath: string;
  requiresConnectedAccount: boolean;
  requiredEnv: string[];
  allowedBaseUrls: string[];
  allowedEndpointPaths: string[];
  requiresApproval: boolean;
  approvalMode: "per-run" | "auto" | null;
  credentialGateStatus: ConnectorCredentialGateStatus;
  reasons: string[];
}

export interface ConnectorExecutionGateManifest {
  schemaVersion: 1;
  generatedAt: string;
  capabilities: ConnectorExecutionGateCapability[];
}

export interface ConnectorExecutionGateInputFile {
  path: string;
  content: string;
}

const INSTAGRAM_ALLOWED_BASE_URLS = new Set([
  "https://graph.facebook.com",
  "https://graph.instagram.com",
  "https://rupload.facebook.com",
]);

const PROVIDER_ALLOWED_BASE_URLS: Partial<Record<ConnectorProvider, Set<string>>> = {
  instagram: INSTAGRAM_ALLOWED_BASE_URLS,
};

const UNSAFE_SCRIPT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(console\.(?:log|error|warn)|process\.stdout\.write)\s*\([^)]*process\.env/isu,
    reason: "Script appears to write environment variables to logs.",
  },
  {
    pattern: /\b(JSON\.stringify)\s*\(\s*process\.env/isu,
    reason: "Script appears to serialize environment variables.",
  },
  {
    pattern: /\b(document\.cookie|localStorage|sessionStorage)\b/isu,
    reason: "Browser cookie or storage access is not allowed for connected execution skills.",
  },
  {
    pattern: /\b(playwright|puppeteer|chromium|selenium)\b/isu,
    reason: "Browser automation endpoints are not allowed for connected execution skills.",
  },
  {
    pattern: /\b(eval|Function)\s*\(/isu,
    reason: "Runtime code generation cannot be verified safely.",
  },
  {
    pattern: /instagram\.com\/api\/v1|i\.instagram\.com|private\s+api|scrap(?:e|ing)/isu,
    reason: "Private API or scraping behavior is not allowed.",
  },
];

export function normalizeConnectorExecutionGate(input: {
  manifest: unknown;
  files: ConnectorExecutionGateInputFile[];
  generatedAt: string;
}): ConnectorExecutionGateManifest {
  const scriptFiles = new Map(
    input.files.map((file) => [normalizePackagePath(file.path), file.content]),
  );
  const capabilities: ConnectorExecutionGateCapability[] = [];

  for (const entry of normalizeManifestEntries(input.manifest)) {
    const provider = readProvider(entry.provider);
    if (!provider) {
      continue;
    }
    const rawCapabilities = Array.isArray(entry.capabilities)
      ? entry.capabilities
      : [];
    for (const rawCapability of rawCapabilities) {
      const capability = normalizeCapability({
        provider,
        raw: rawCapability,
        scriptFiles,
      });
      if (capability) {
        capabilities.push(capability);
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    capabilities: capabilities.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

export function parseConnectorExecutionGate(
  value: unknown,
): ConnectorExecutionGateManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<ConnectorExecutionGateManifest>;
  if (record.schemaVersion !== 1 || !Array.isArray(record.capabilities)) {
    return null;
  }
  const capabilities = record.capabilities
    .map(parseGateCapability)
    .filter(
      (capability): capability is ConnectorExecutionGateCapability =>
        capability !== null,
    );
  return {
    schemaVersion: 1,
    generatedAt:
      typeof record.generatedAt === "string" ? record.generatedAt : "",
    capabilities,
  };
}

export function findGateCapability(
  gate: ConnectorExecutionGateManifest | null,
  capabilityId: string,
): ConnectorExecutionGateCapability | null {
  return (
    gate?.capabilities.find((capability) => capability.id === capabilityId) ??
    null
  );
}

function normalizeCapability(input: {
  provider: ConnectorProvider;
  raw: unknown;
  scriptFiles: Map<string, string>;
}): ConnectorExecutionGateCapability | null {
  if (!input.raw || typeof input.raw !== "object" || Array.isArray(input.raw)) {
    return null;
  }
  const record = input.raw as Record<string, unknown>;
  const id = readNonEmptyString(record.id);
  const action = readAction(record.action);
  const scriptPath = readSafeRelativePath(record.scriptPath);
  const reasons: string[] = [];

  if (!id) {
    reasons.push("Capability id is required.");
  }
  if (!action) {
    reasons.push("Capability action must be read or write.");
  }
  if (!scriptPath) {
    reasons.push("Capability scriptPath must be a safe relative path.");
  }

  if (!id || !action || !scriptPath) {
    return null;
  }

  const requiredEnv = readStringArray(record.requiredEnv);
  const requiresConnectedAccount =
    readBoolean(record.requiresConnectedAccount) === true ||
    requiredEnv.length > 0;
  const allowedBaseUrls = normalizeBaseUrls(record.allowedBaseUrls, reasons);
  const allowedEndpointPaths = normalizeEndpointPaths(
    record.allowedEndpointPaths,
    reasons,
  );
  const requiresApproval = readBoolean(record.requiresApproval) ?? false;
  const approvalMode = readApprovalMode(record.approvalMode);

  if (requiresConnectedAccount) {
    validateConnectedAccountCapability({
      provider: input.provider,
      action,
      allowedBaseUrls,
      allowedEndpointPaths,
      requiresApproval,
      approvalMode,
      reasons,
    });
    validateScriptContent({
      scriptPath,
      scriptContent: input.scriptFiles.get(normalizePackagePath(scriptPath)),
      reasons,
    });
  }

  return {
    id,
    provider: input.provider,
    action,
    scriptPath,
    requiresConnectedAccount,
    requiredEnv,
    allowedBaseUrls,
    allowedEndpointPaths,
    requiresApproval,
    approvalMode,
    credentialGateStatus: requiresConnectedAccount
      ? reasons.length === 0
        ? "allowed"
        : "blocked"
      : "not-required",
    reasons,
  };
}

function validateConnectedAccountCapability(input: {
  provider: ConnectorProvider;
  action: ConnectorCapabilityAction;
  allowedBaseUrls: string[];
  allowedEndpointPaths: string[];
  requiresApproval: boolean;
  approvalMode: "per-run" | "auto" | null;
  reasons: string[];
}): void {
  if (input.allowedBaseUrls.length === 0) {
    input.reasons.push("allowedBaseUrls is required before injecting account credentials.");
  }

  const allowedForProvider = PROVIDER_ALLOWED_BASE_URLS[input.provider];
  if (allowedForProvider) {
    for (const baseUrl of input.allowedBaseUrls) {
      if (!allowedForProvider.has(baseUrl)) {
        input.reasons.push(
          `${baseUrl} is not on the official ${input.provider} API origin allowlist.`,
        );
      }
    }
  }

  if (input.action === "write") {
    if (input.allowedEndpointPaths.length === 0) {
      input.reasons.push("Write capabilities require allowedEndpointPaths.");
    }
    if (!input.requiresApproval && input.approvalMode !== "per-run") {
      input.reasons.push("Write capabilities require per-run approval.");
    }
  }
}

function validateScriptContent(input: {
  scriptPath: string;
  scriptContent: string | undefined;
  reasons: string[];
}): void {
  if (typeof input.scriptContent !== "string") {
    input.reasons.push(`scriptPath not found in package: ${input.scriptPath}`);
    return;
  }

  for (const unsafe of UNSAFE_SCRIPT_PATTERNS) {
    if (unsafe.pattern.test(input.scriptContent)) {
      input.reasons.push(unsafe.reason);
    }
  }
}

function normalizeManifestEntries(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.connectors)) {
    return record.connectors.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object" && !Array.isArray(entry),
    );
  }
  if (typeof record.provider === "string") {
    return [record];
  }
  return [];
}

function parseGateCapability(
  value: unknown,
): ConnectorExecutionGateCapability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<ConnectorExecutionGateCapability>;
  const provider = readProvider(record.provider);
  const action = readAction(record.action);
  if (
    typeof record.id !== "string" ||
    !provider ||
    !action ||
    typeof record.scriptPath !== "string"
  ) {
    return null;
  }
  const status =
    record.credentialGateStatus === "allowed" ||
    record.credentialGateStatus === "blocked" ||
    record.credentialGateStatus === "not-required"
      ? record.credentialGateStatus
      : "blocked";
  return {
    id: record.id,
    provider,
    action,
    scriptPath: record.scriptPath,
    requiresConnectedAccount: record.requiresConnectedAccount === true,
    requiredEnv: readStringArray(record.requiredEnv),
    allowedBaseUrls: readStringArray(record.allowedBaseUrls),
    allowedEndpointPaths: readStringArray(record.allowedEndpointPaths),
    requiresApproval: record.requiresApproval === true,
    approvalMode: readApprovalMode(record.approvalMode),
    credentialGateStatus: status,
    reasons: readStringArray(record.reasons),
  };
}

function readProvider(value: unknown): ConnectorProvider | null {
  if (typeof value !== "string") {
    return null;
  }
  const provider = value.trim() as ConnectorProvider;
  return listSupportedProviders().includes(provider) ? provider : null;
}

function readAction(value: unknown): ConnectorCapabilityAction | null {
  return value === "read" || value === "write" ? value : null;
}

function readApprovalMode(value: unknown): "per-run" | "auto" | null {
  return value === "per-run" || value === "auto" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function readSafeRelativePath(value: unknown): string | null {
  const candidate = readNonEmptyString(value);
  if (!candidate) {
    return null;
  }
  const normalized = normalizePackagePath(candidate);
  if (
    path.isAbsolute(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function normalizeBaseUrls(value: unknown, reasons: string[]): string[] {
  const urls: string[] = [];
  for (const rawUrl of readStringArray(value)) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      reasons.push(`Invalid allowedBaseUrl: ${rawUrl}`);
      continue;
    }
    if (parsed.protocol !== "https:") {
      reasons.push(`allowedBaseUrl must use https: ${rawUrl}`);
      continue;
    }
    urls.push(parsed.origin);
  }
  return [...new Set(urls)].sort();
}

function normalizeEndpointPaths(value: unknown, reasons: string[]): string[] {
  const paths: string[] = [];
  for (const endpointPath of readStringArray(value)) {
    const normalized = endpointPath.trim();
    if (
      !normalized.startsWith("/") ||
      normalized.includes("\0") ||
      /^https?:\/\//iu.test(normalized)
    ) {
      reasons.push(`allowedEndpointPath must be a URL path prefix: ${endpointPath}`);
      continue;
    }
    paths.push(normalized);
  }
  return [...new Set(paths)].sort();
}

function normalizePackagePath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\.\/+/u, "");
}
