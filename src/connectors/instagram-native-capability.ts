import type {
  ConnectorCapabilityAction,
  ConnectorCapabilityRecord,
  ConnectorProvider,
} from "./connector-types.js";

export type InstagramAccountKind =
  | "unknown"
  | "personal"
  | "professional_business"
  | "professional_creator";

export type InstagramGraphCapabilityStatus = "available" | "blocked" | "planned";

export type InstagramGraphBlockerCode =
  | "professional_account_required"
  | "facebook_page_required"
  | "meta_business_setup_required"
  | "meta_app_required"
  | "permission_missing"
  | "app_review_required"
  | "access_token_missing"
  | "instagram_business_account_id_missing"
  | "rocky_capability_not_implemented";

export interface InstagramGraphCapabilityReadiness {
  id: string;
  status: InstagramGraphCapabilityStatus;
  blockerCodes: InstagramGraphBlockerCode[];
  setupSteps: string[];
}

export interface InstagramGraphApiReadiness {
  provider: "instagram";
  setupMode: "graph-api";
  accountKind: InstagramAccountKind;
  accountLabel: string | null;
  instagramBusinessAccountId: string | null;
  available: boolean;
  blockerCodes: InstagramGraphBlockerCode[];
  setupSteps: string[];
  capabilities: InstagramGraphCapabilityReadiness[];
}

interface InstagramNativeCapabilityDefinition {
  id: string;
  operation: string;
  label: string;
  description: string;
  action: ConnectorCapabilityAction;
  requiresApproval: boolean;
  requiredPermissions: string[];
  allowedEndpointPaths: string[];
}

const PROVIDER: ConnectorProvider = "instagram";

const GRAPH_BASE_URLS = [
  "https://graph.facebook.com",
  "https://graph.instagram.com",
];

const GRAPH_TOKEN_ENV = [
  "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN",
  "ROCKY_CONNECTOR_INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_GRAPH_ACCESS_TOKEN",
  "INSTAGRAM_ACCESS_TOKEN",
];

const GRAPH_ACCOUNT_ID_ENV = [
  "ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_ID",
  "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "INSTAGRAM_ACCOUNT_ID",
];

const GRAPH_ACCOUNT_KIND_ENV = [
  "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_KIND",
  "INSTAGRAM_ACCOUNT_KIND",
];

const GRAPH_PERMISSION_ENV = [
  "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS",
  "ROCKY_CONNECTOR_INSTAGRAM_PERMISSIONS",
  "INSTAGRAM_GRAPH_PERMISSIONS",
  "INSTAGRAM_PERMISSIONS",
];

const GRAPH_ACCOUNT_LABEL_ENV = [
  "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_LABEL",
  "INSTAGRAM_ACCOUNT_LABEL",
];

const NATIVE_CAPABILITIES: InstagramNativeCapabilityDefinition[] = [
  {
    id: "instagram.account.read",
    operation: "account.read",
    label: "Instagram Graph account read",
    description:
      "Confirms that Rocky has a Professional Instagram account connected through the Instagram Graph API.",
    action: "read",
    requiresApproval: false,
    requiredPermissions: ["instagram_basic"],
    allowedEndpointPaths: ["/{ig-user-id}"],
  },
  {
    id: "instagram.media.prepare",
    operation: "media.prepare",
    label: "Instagram media prepare",
    description:
      "Prepares Instagram feed or Reels media payloads for Graph API publishing without submitting them.",
    action: "read",
    requiresApproval: false,
    requiredPermissions: ["instagram_basic", "instagram_content_publish"],
    allowedEndpointPaths: ["/{ig-user-id}/media"],
  },
  {
    id: "instagram.media.publish",
    operation: "media.publish",
    label: "Instagram media publish",
    description:
      "Publishes prepared Instagram media through the Graph API after preview and explicit user approval.",
    action: "write",
    requiresApproval: true,
    requiredPermissions: ["instagram_basic", "instagram_content_publish"],
    allowedEndpointPaths: ["/{ig-user-id}/media_publish"],
  },
  {
    id: "instagram.media.status.read",
    operation: "media.status.read",
    label: "Instagram media status read",
    description:
      "Reads Graph API media container or publishing status for prepared Instagram media.",
    action: "read",
    requiresApproval: false,
    requiredPermissions: ["instagram_basic", "instagram_content_publish"],
    allowedEndpointPaths: ["/{creation-id}", "/{media-id}"],
  },
  {
    id: "instagram.insights.read",
    operation: "insights.read",
    label: "Instagram insights read",
    description:
      "Reads Instagram account or media insights through the Graph API when the approved permission is present.",
    action: "read",
    requiresApproval: false,
    requiredPermissions: ["instagram_basic", "instagram_manage_insights"],
    allowedEndpointPaths: ["/{ig-user-id}/insights", "/{media-id}/insights"],
  },
  {
    id: "instagram.automation.prepare",
    operation: "prepare",
    label: "Instagram Graph API readiness",
    description:
      "Checks whether Instagram native capabilities can run through Graph API credentials.",
    action: "read",
    requiresApproval: false,
    requiredPermissions: ["instagram_basic"],
    allowedEndpointPaths: ["/{ig-user-id}"],
  },
];

const CAPABILITY_IDS = new Set(NATIVE_CAPABILITIES.map((capability) => capability.id));

export function isInstagramNativeCapabilityId(capabilityId: string): boolean {
  return CAPABILITY_IDS.has(capabilityId);
}

export function instagramNativeCapabilityOperationMap(): Map<string, string> {
  return new Map(
    NATIVE_CAPABILITIES.map((capability) => [
      capability.operation,
      capability.id,
    ]),
  );
}

export function instagramNativeCapabilityDefinitions(): InstagramNativeCapabilityDefinition[] {
  return [...NATIVE_CAPABILITIES];
}

export function resolveInstagramGraphApiReadiness(
  env: NodeJS.ProcessEnv,
): InstagramGraphApiReadiness {
  const accessToken = readEnvAny(env, GRAPH_TOKEN_ENV);
  const accountId = readEnvAny(env, GRAPH_ACCOUNT_ID_ENV);
  const accountKind = readInstagramAccountKind(
    readEnvAny(env, GRAPH_ACCOUNT_KIND_ENV),
  );
  const permissions = readPermissionSet(readEnvAny(env, GRAPH_PERMISSION_ENV));
  const accountLabel =
    readEnvAny(env, GRAPH_ACCOUNT_LABEL_ENV) ??
    (accountId ? `Instagram Graph account ${accountId}` : null);
  const globalBlockers: InstagramGraphBlockerCode[] = [];

  if (
    accountKind !== "professional_business" &&
    accountKind !== "professional_creator"
  ) {
    globalBlockers.push("professional_account_required");
  }
  if (!accessToken) {
    globalBlockers.push("access_token_missing");
  }
  if (!accountId) {
    globalBlockers.push("instagram_business_account_id_missing");
  }

  const capabilities = NATIVE_CAPABILITIES.map((capability) => {
    const blockerCodes = uniqueBlockers([
      ...globalBlockers,
      ...missingPermissionBlockers(capability.requiredPermissions, permissions),
    ]);
    return {
      id: capability.id,
      status:
        blockerCodes.length === 0
          ? ("available" as const)
          : ("blocked" as const),
      blockerCodes,
      setupSteps: setupStepsForBlockers(blockerCodes),
    };
  });
  const accountCapability = capabilities.find(
    (capability) => capability.id === "instagram.account.read",
  );
  const blockerCodes = accountCapability?.blockerCodes ?? globalBlockers;

  return {
    provider: "instagram",
    setupMode: "graph-api",
    accountKind,
    accountLabel,
    instagramBusinessAccountId: accountId,
    available: blockerCodes.length === 0,
    blockerCodes,
    setupSteps: setupStepsForBlockers(blockerCodes),
    capabilities,
  };
}

export function buildInstagramNativeCapabilityRecords(
  env: NodeJS.ProcessEnv,
): ConnectorCapabilityRecord[] {
  const readiness = resolveInstagramGraphApiReadiness(env);
  const readinessById = new Map(
    readiness.capabilities.map((capability) => [capability.id, capability]),
  );

  return NATIVE_CAPABILITIES.map((capability) => {
    const capabilityReadiness = readinessById.get(capability.id);
    return {
      id: capability.id,
      provider: PROVIDER,
      label: capability.label,
      description: capability.description,
      action: capability.action,
      requiresBrowser: false,
      requiresConnectedAccount: true,
      requiresApproval: capability.requiresApproval,
      status: capabilityReadiness?.status ?? "blocked",
      source: "backend",
      setupMode: "graph-api",
      blockerCodes: capabilityReadiness?.blockerCodes ?? [],
      setupSteps: capabilityReadiness?.setupSteps ?? [],
      requiredEnv: [
        "INSTAGRAM_ACCOUNT_KIND",
        "INSTAGRAM_GRAPH_ACCESS_TOKEN",
        "INSTAGRAM_BUSINESS_ACCOUNT_ID",
        "INSTAGRAM_GRAPH_PERMISSIONS",
      ],
      allowedBaseUrls: GRAPH_BASE_URLS,
      allowedEndpointPaths: capability.allowedEndpointPaths,
    };
  });
}

export function buildInstagramBlockedMessage(input: {
  capabilityId: string;
  blockerCodes: string[];
  setupSteps: string[];
}): string {
  return [
    `${input.capabilityId} is blocked until Instagram Graph API setup is complete.`,
    `blockers=${input.blockerCodes.join(", ") || "none"}`,
    `next_steps=${input.setupSteps.join(" | ") || "none"}`,
  ].join(" ");
}

export function buildInstagramNativeSkillManifest(): string {
  return `${JSON.stringify(
    {
      provider: PROVIDER,
      setupMode: "graph-api",
      accountKind: [
        "unknown",
        "personal",
        "professional_business",
        "professional_creator",
      ],
      browserSessionPolicy:
        "manual_assist_or_readiness_check_only; never pass cookies, session storage, or browser profile paths to skills.",
      capabilities: NATIVE_CAPABILITIES.map((capability) => ({
        id: capability.id,
        label: capability.label,
        description: capability.description,
        action: capability.action,
        setupMode: "graph-api",
        requiresBrowser: false,
        requiresConnectedAccount: true,
        requiresApproval: capability.requiresApproval,
        approvalMode: capability.requiresApproval ? "per-run" : null,
        requiredEnv: [
          "INSTAGRAM_ACCOUNT_KIND",
          "INSTAGRAM_GRAPH_ACCESS_TOKEN",
          "INSTAGRAM_BUSINESS_ACCOUNT_ID",
          "INSTAGRAM_GRAPH_PERMISSIONS",
        ],
        allowedBaseUrls: GRAPH_BASE_URLS,
        allowedEndpointPaths: capability.allowedEndpointPaths,
        scriptPath: "scripts/instagram-graph.mjs",
        usage: `node scripts/instagram-graph.mjs ${capability.operation}`,
      })),
      unsupportedActions: [
        "follow automation",
        "like automation",
        "multi-account seeding",
        "unauthorized DM or comment automation",
        "Playwright-based Instagram publishing",
      ],
    },
    null,
    2,
  )}\n`;
}

export function buildInstagramNativeSkillScript(): string {
  const operationEntries = [...instagramNativeCapabilityOperationMap().entries()]
    .map(([operation, capabilityId]) => `  ["${operation}", "${capabilityId}"],`)
    .join("\n");

  return `#!/usr/bin/env node
const operation = process.argv[2] || "help";
const supported = new Map([
${operationEntries}
]);

if (operation === "help" || operation === "--help" || operation === "-h") {
  printUsage();
  process.exit(0);
}

const capabilityId = supported.get(operation);
if (!capabilityId) {
  console.error(JSON.stringify({
    ok: false,
    message: "Unsupported Instagram native capability operation.",
    operation,
    supported: Array.from(supported.keys()),
  }, null, 2));
  process.exit(2);
}

const args = parseArgs(process.argv.slice(3));
const baseUrl = (
  process.env.ROCKY_CONNECTOR_BASE_URL ||
  process.env.ROCKY_API_BASE_URL ||
  process.env.ROCKY_AGENT_ENGINE_URL ||
  "http://127.0.0.1:3000"
).replace(/\\/+$/u, "");

try {
  const response = await fetch(
    new URL("/connectors/instagram/capabilities/" + encodeURIComponent(capabilityId) + "/execute", baseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    },
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || !payload || payload.ok === false) {
    console.error(JSON.stringify(payload || {
      ok: false,
      statusCode: response.status,
      message: response.statusText,
    }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  const cause = error instanceof Error && error.cause ? String(error.cause) : null;
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    cause,
    hint: cause && /EPERM|Operation not permitted/iu.test(cause)
      ? "This execution session cannot access the local Rocky connector endpoint. Run with local network permission or execute through the Rocky backend host."
      : "Set ROCKY_CONNECTOR_BASE_URL when Rocky backend is not listening on http://127.0.0.1:3000.",
  }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const raw = argv[index + 1];
    if (!key || raw === undefined || raw.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = raw;
    index += 1;
  }
  return args;
}

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/instagram-graph.mjs account.read",
    "  node scripts/instagram-graph.mjs media.prepare --caption draft.md",
    "  node scripts/instagram-graph.mjs media.publish --creation-id <id>",
    "  node scripts/instagram-graph.mjs media.status.read --creation-id <id>",
    "  node scripts/instagram-graph.mjs insights.read --metric impressions",
    "",
    "Policy:",
    "  Uses Rocky backend Instagram Graph API readiness only.",
    "  Publishing requires preview and explicit user approval.",
    "  Browser cookies, session storage, and profile paths are never accepted.",
    "",
    "Environment:",
    "  ROCKY_CONNECTOR_BASE_URL=http://127.0.0.1:3000",
  ].join("\\n"));
}
`;
}

function missingPermissionBlockers(
  requiredPermissions: string[],
  grantedPermissions: Set<string>,
): InstagramGraphBlockerCode[] {
  if (requiredPermissions.length === 0) {
    return [];
  }
  return requiredPermissions.every((permission) => grantedPermissions.has(permission))
    ? []
    : ["permission_missing"];
}

function setupStepsForBlockers(
  blockers: InstagramGraphBlockerCode[],
): string[] {
  const steps: string[] = [];
  const blockerSet = new Set(blockers);
  if (blockerSet.has("professional_account_required")) {
    steps.push("Switch the Instagram account to Business or Creator.");
  }
  if (blockerSet.has("facebook_page_required")) {
    steps.push("Connect the Instagram professional account to a Facebook Page.");
  }
  if (blockerSet.has("meta_business_setup_required")) {
    steps.push("Complete Meta Business setup for the connected account.");
  }
  if (blockerSet.has("meta_app_required")) {
    steps.push("Configure a Meta app for Instagram Graph API access.");
  }
  if (blockerSet.has("permission_missing")) {
    steps.push(
      "Grant and record the required Graph API permissions, such as instagram_basic, instagram_content_publish, and instagram_manage_insights.",
    );
  }
  if (blockerSet.has("app_review_required")) {
    steps.push("Complete Meta app review for permissions that require review.");
  }
  if (blockerSet.has("access_token_missing")) {
    steps.push("Connect a valid Instagram Graph API access token.");
  }
  if (blockerSet.has("instagram_business_account_id_missing")) {
    steps.push("Record the Instagram Business Account ID used by the Graph API.");
  }
  if (blockerSet.has("rocky_capability_not_implemented")) {
    steps.push("Wait for Rocky to implement this native capability.");
  }
  return [...new Set(steps)];
}

function uniqueBlockers(
  blockers: InstagramGraphBlockerCode[],
): InstagramGraphBlockerCode[] {
  return [...new Set(blockers)];
}

function readInstagramAccountKind(value: string | null): InstagramAccountKind {
  if (
    value === "personal" ||
    value === "professional_business" ||
    value === "professional_creator"
  ) {
    return value;
  }
  return "unknown";
}

function readPermissionSet(value: string | null): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[,\s]+/u)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function readEnvAny(env: NodeJS.ProcessEnv, keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}
