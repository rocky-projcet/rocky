import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentLocalSkillRecord } from "../agents/agent-local-skill-service.js";

import { getConnectorAdapter, listSupportedProviders } from "./adapters.js";
import type {
  AgentConnectorIntegrationRecord,
  ConnectorCapabilityAction,
  ConnectorCapabilityRecord,
  ConnectorProvider,
  ConnectorServiceLike,
  ConnectorState,
} from "./connector-types.js";
import {
  CONNECTOR_EXECUTION_GATE_FILE,
  findGateCapability,
  parseConnectorExecutionGate,
  type ConnectorExecutionGateManifest,
} from "./connector-execution-gate.js";

const CONNECTOR_CAPABILITY_MANIFEST = "connector-capabilities.json";

const PROVIDER_KEYWORDS: Record<ConnectorProvider, RegExp[]> = {
  threads: [/threads/iu, /쓰레드|스레드/iu],
  instagram: [/instagram/iu, /인스타그램|인스타/iu],
  x: [/\bx\b/iu, /twitter/iu, /트위터/iu],
  facebook: [/facebook/iu, /페이스북/iu],
  linkedin: [/linkedin/iu, /링크드인/iu],
  tiktok: [/tiktok/iu, /틱톡/iu],
  youtube: [/youtube/iu, /유튜브/iu],
  "naver-blog": [/naver\s*blog/iu, /네이버\s*블로그/iu],
  tistory: [/tistory/iu, /티스토리/iu],
  brunch: [/brunch/iu, /브런치/iu],
  "kakao-channel": [/kakao\s*channel/iu, /카카오\s*채널/iu],
  medium: [/medium/iu],
};

export async function listAgentConnectorIntegrations(input: {
  skills: AgentLocalSkillRecord[];
  connectorService: ConnectorServiceLike | null | undefined;
}): Promise<AgentConnectorIntegrationRecord[]> {
  const requiredByProvider = new Map<
    ConnectorProvider,
    Array<{ id: string; displayName: string }>
  >();
  const capabilitiesByProvider = new Map<
    ConnectorProvider,
    ConnectorCapabilityRecord[]
  >();

  for (const skill of input.skills) {
    const manifest = await readSkillConnectorManifest(skill);
    const providers = detectConnectorProviders(
      [
        skill.id,
        skill.displayName,
        skill.description ?? "",
        await readSkillFile(skill.skillPath),
      ].join("\n")
    );
    for (const provider of manifest.providers) {
      providers.push(provider);
    }
    for (const provider of [...new Set(providers)]) {
      const current = requiredByProvider.get(provider) ?? [];
      current.push({ id: skill.id, displayName: skill.displayName });
      requiredByProvider.set(provider, current);
    }
    for (const [provider, capabilities] of manifest.capabilitiesByProvider) {
      const current = capabilitiesByProvider.get(provider) ?? [];
      capabilitiesByProvider.set(
        provider,
        mergeCapabilities([...current, ...capabilities]),
      );
    }
  }

  const integrations: AgentConnectorIntegrationRecord[] = [];
  for (const [provider, requiredBySkills] of requiredByProvider) {
    const state = input.connectorService
      ? await input.connectorService.getState(provider)
      : buildUnavailableState(provider);
    integrations.push(
      toAgentConnectorIntegration(
        state,
        requiredBySkills,
        capabilitiesByProvider.get(provider) ?? [],
      ),
    );
  }

  return integrations.sort((left, right) => left.label.localeCompare(right.label));
}

export function detectConnectorProviders(text: string): ConnectorProvider[] {
  const providers: ConnectorProvider[] = [];
  for (const provider of listSupportedProviders()) {
    if (PROVIDER_KEYWORDS[provider].some((pattern) => pattern.test(text))) {
      providers.push(provider);
    }
  }
  return providers;
}

function toAgentConnectorIntegration(
  state: ConnectorState,
  requiredBySkills: Array<{ id: string; displayName: string }>,
  capabilities: ConnectorCapabilityRecord[],
): AgentConnectorIntegrationRecord {
  const normalizedCapabilities =
    state.status === "planned"
      ? capabilities.map((capability) => ({
          ...capability,
          status: "planned" as const,
        }))
      : capabilities;

  return {
    provider: state.provider,
    label: getConnectorAdapter(state.provider).label,
    status: state.status,
    loginMode: state.loginMode,
    accountLabel: state.accountLabel,
    connectedAt: state.connectedAt,
    browserAccess: state.browserAccess,
    capabilities: normalizedCapabilities,
    readiness: state.readiness,
    requiredBySkills,
  };
}

async function readSkillConnectorManifest(
  skill: AgentLocalSkillRecord,
): Promise<{
  providers: ConnectorProvider[];
  capabilitiesByProvider: Map<ConnectorProvider, ConnectorCapabilityRecord[]>;
}> {
  const manifestPath = path.join(
    path.dirname(skill.skillPath),
    CONNECTOR_CAPABILITY_MANIFEST,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return {
      providers: [],
      capabilitiesByProvider: new Map(),
    };
  }

  const gate = await readSkillConnectorGate(skill);
  const providers: ConnectorProvider[] = [];
  const capabilitiesByProvider = new Map<ConnectorProvider, ConnectorCapabilityRecord[]>();
  for (const entry of normalizeManifestEntries(parsed)) {
    const provider = readProvider((entry as Record<string, unknown>).provider);
    if (!provider) {
      continue;
    }
    providers.push(provider);
    const capabilities = readManifestCapabilities({
      provider,
      rawCapabilities: (entry as Record<string, unknown>).capabilities,
      skill,
      gate,
    });
    if (capabilities.length > 0) {
      capabilitiesByProvider.set(
        provider,
        mergeCapabilities([
          ...(capabilitiesByProvider.get(provider) ?? []),
          ...capabilities,
        ]),
      );
    }
  }

  return {
    providers: [...new Set(providers)],
    capabilitiesByProvider,
  };
}

function normalizeManifestEntries(parsed: unknown): Record<string, unknown>[] {
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

function readManifestCapabilities(input: {
  provider: ConnectorProvider;
  rawCapabilities: unknown;
  skill: AgentLocalSkillRecord;
  gate: ConnectorExecutionGateManifest | null;
}): ConnectorCapabilityRecord[] {
  if (!Array.isArray(input.rawCapabilities)) {
    return [];
  }

  return input.rawCapabilities
    .map((raw) =>
      readManifestCapability(input.provider, raw, input.skill, input.gate),
    )
    .filter(
      (capability): capability is ConnectorCapabilityRecord =>
        capability !== null,
    );
}

function readManifestCapability(
  provider: ConnectorProvider,
  raw: unknown,
  skill: AgentLocalSkillRecord,
  gate: ConnectorExecutionGateManifest | null,
): ConnectorCapabilityRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = readNonEmptyString(record.id);
  const action = readCapabilityAction(record.action);
  if (!id || !action) {
    return null;
  }
  const label = readNonEmptyString(record.label) ?? id;
  const description =
    readNonEmptyString(record.description) ??
    `External skill capability ${id}.`;

  const gateCapability = findGateCapability(gate, id);
  const gateBlocked = gateCapability?.credentialGateStatus === "blocked";

  return {
    id,
    provider,
    label,
    description,
    action,
    requiresBrowser: readBoolean(record.requiresBrowser) ?? false,
    requiresConnectedAccount:
      readBoolean(record.requiresConnectedAccount) ??
      readStringArray(record.requiredEnv).length > 0,
    requiresApproval: readBoolean(record.requiresApproval) ?? action === "write",
    status: readCapabilityStatus(record.status),
    source: "skill",
    sourceSkillId: skill.id,
    sourceSkillName: skill.displayName,
    scriptPath: readSafeRelativePath(record.scriptPath),
    usage: readNonEmptyString(record.usage),
    requiredEnv: readStringArray(record.requiredEnv),
    allowedBaseUrls: readStringArray(record.allowedBaseUrls),
    allowedEndpointPaths: readStringArray(record.allowedEndpointPaths),
    credentialGateStatus: gateCapability?.credentialGateStatus,
    credentialGateReasons: gateCapability?.reasons,
    ...(gateBlocked ? { status: "unsupported" as const } : {}),
  };
}

async function readSkillConnectorGate(
  skill: AgentLocalSkillRecord,
): Promise<ConnectorExecutionGateManifest | null> {
  const gatePath = path.join(path.dirname(skill.skillPath), CONNECTOR_EXECUTION_GATE_FILE);
  try {
    return parseConnectorExecutionGate(JSON.parse(await readFile(gatePath, "utf8")));
  } catch {
    return null;
  }
}

function readProvider(value: unknown): ConnectorProvider | null {
  if (typeof value !== "string") {
    return null;
  }
  const provider = value.trim() as ConnectorProvider;
  return listSupportedProviders().includes(provider) ? provider : null;
}

function readCapabilityAction(value: unknown): ConnectorCapabilityAction | null {
  return value === "read" || value === "write" ? value : null;
}

function readCapabilityStatus(
  value: unknown,
): ConnectorCapabilityRecord["status"] {
  return value === "available" ||
    value === "blocked" ||
    value === "planned" ||
    value === "unsupported"
    ? value
    : undefined;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
  if (
    path.isAbsolute(candidate) ||
    candidate.includes("\0") ||
    candidate.split(/[\\/]+/u).some((segment) => segment === "..")
  ) {
    return null;
  }
  return candidate;
}

function mergeCapabilities(
  capabilities: ConnectorCapabilityRecord[],
): ConnectorCapabilityRecord[] {
  const byId = new Map<string, ConnectorCapabilityRecord>();
  for (const capability of capabilities) {
    byId.set(capability.id, capability);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function readSkillFile(skillPath: string): Promise<string> {
  try {
    return await readFile(skillPath, "utf8");
  } catch {
    return "";
  }
}

function buildUnavailableState(provider: ConnectorProvider): ConnectorState {
  return {
    provider,
    status: "idle",
    message: "연동 상태를 확인할 수 없습니다.",
    accountLabel: null,
    connectedAt: null,
    loginUrl: null,
    loginMode: null,
    lastError: null,
    failureKind: null,
    browserAccess: {
      status: "unavailable",
      policy: null,
      readAllowed: false,
      writeAllowedAfterApproval: false,
      message: "연동 서비스가 준비되지 않았습니다.",
    },
    capabilities: [],
    readiness: {
      setupMode: null,
      accountKind: null,
      browserSessionPurpose: null,
      blockers: [],
    },
    updatedAt: new Date(0).toISOString(),
  };
}
