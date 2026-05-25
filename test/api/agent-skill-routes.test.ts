import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";
import type { AgentConnectorIntegrationRecord } from "../../src/connectors/connector-types.js";

const INSTAGRAM_GRAPH_ENV = {
  ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_KIND: "professional_business",
  ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN: "instagram-graph-secret",
  ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841400000000002",
  ROCKY_CONNECTOR_INSTAGRAM_FACEBOOK_PAGE_ID: "112233445566",
  ROCKY_CONNECTOR_INSTAGRAM_META_BUSINESS_ID: "998877665544",
  ROCKY_CONNECTOR_INSTAGRAM_META_APP_ID: "123456789",
  ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS:
    "instagram_basic pages_show_list instagram_content_publish instagram_manage_insights",
};

test("agent skill routes list and delete only workspace-local skills", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-skill-api-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-04-26T00:00:00.000Z",
    idGenerator: () => "skill-route-agent",
  });

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "skill-route-agent",
        name: "Skill Route Agent",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const agent = createResponse.json<AgentRecord>();
    const skillDir = path.join(agent.workspaceRoot, ".agents", "skills", "slides");
    const runtimeSkillDir = path.join(agent.runtimeHome, ".codex", "skills", "slides");
    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/skill-route-agent/skills/slides",
      payload: {
        replace: true,
        files: [
          {
            path: "SKILL.md",
            content: "---\nname: slides\n---\n",
          },
          {
            path: "references/readme.md",
            content: "# Slides\n",
          },
        ],
      },
    });
    assert.equal(installResponse.statusCode, 200);
    assert.equal(installResponse.json().skill.id, "slides");
    assert.equal(
      installResponse.json().skill.runtimePath,
      path.join(".codex", "skills", "slides")
    );
    await access(path.join(skillDir, "references", "readme.md"));
    await access(path.join(runtimeSkillDir, "references", "readme.md"));

    const listResponse = await server.inject({
      method: "GET",
      url: "/agents/skill-route-agent/skills",
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json<Array<{ id: string }>>().map((skill) => skill.id),
      ["slides"]
    );

    const deleteResponse = await server.inject({
      method: "DELETE",
      url: "/agents/skill-route-agent/skills/slides",
    });
    assert.equal(deleteResponse.statusCode, 200);
    assert.equal(deleteResponse.json().deleted, true);
    assert.deepEqual(deleteResponse.json().skills, []);
    await assert.rejects(access(skillDir));
    await assert.rejects(access(runtimeSkillDir));
    await access(path.join(agent.workspaceRoot, ".agents", "skills"));
  } finally {
    await server.close();
  }
});

test("agent skill install route accepts packaged files over the default body limit", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-skill-large-api-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-02T00:00:00.000Z",
    idGenerator: () => "large-skill-agent",
  });

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "large-skill-agent",
        name: "Large Skill Agent",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const agent = createResponse.json<AgentRecord>();
    const largeContent = "x".repeat(1024 * 1024 + 64 * 1024);

    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/large-skill-agent/skills/large-data",
      payload: {
        replace: true,
        files: [
          {
            path: "SKILL.md",
            content: "---\nname: large-data\n---\n# Large Data\n",
          },
          {
            path: "assets/inputs/dataset/large.txt",
            content: largeContent,
          },
        ],
      },
    });

    assert.equal(installResponse.statusCode, 200);
    assert.equal(installResponse.json().skill.id, "large-data");
    assert.equal(
      await readFile(
        path.join(
          agent.runtimeHome,
          ".codex",
          "skills",
          "large-data",
          "assets",
          "inputs",
          "dataset",
          "large.txt"
        ),
        "utf8"
      ),
      largeContent
    );
  } finally {
    await server.close();
  }
});

test("agent integrations list connectors required by installed skills", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-integrations-api-"));
  await mkdir(path.join(stateRoot, "connectors", "threads"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "threads", "browser-session.json"),
    JSON.stringify(
      {
        provider: "threads",
        accountLabel: "Threads 계정",
        connectedAt: "2026-05-10T11:30:00.000Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-10T12:00:00.000Z",
    idGenerator: () => "threads-agent",
  });

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "threads-agent",
        name: "Threads Agent",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const agent = createResponse.json<AgentRecord>();

    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/threads-agent/skills/md-sns-threads",
      payload: {
        replace: true,
        files: [
          {
            path: "SKILL.md",
            content: "---\nname: md-sns-threads\n---\n# SNS · Threads 콘텐츠\n",
          },
        ],
      },
    });
    assert.equal(installResponse.statusCode, 200);
    await access(
      path.join(
        agent.workspaceRoot,
        ".agents",
        "skills",
        "md-sns-threads",
        "connector-capabilities.json",
      ),
    );
    await access(
      path.join(
        agent.workspaceRoot,
        ".agents",
        "skills",
        "md-sns-threads",
        "scripts",
        "threads-crud.mjs",
      ),
    );

    const integrationsResponse = await server.inject({
      method: "GET",
      url: "/agents/threads-agent/integrations",
    });
    assert.equal(integrationsResponse.statusCode, 200);
    const integrations =
      integrationsResponse.json<AgentConnectorIntegrationRecord[]>();
    assert.equal(integrations.length, 1);
    assert.equal(integrations[0]?.provider, "threads");
    assert.equal(integrations[0]?.status, "connected");
    assert.equal(integrations[0]?.browserAccess.status, "granted");
    assert.equal(integrations[0]?.browserAccess.policy, "persistent");
    assert.equal(integrations[0]?.requiredBySkills[0]?.displayName, "SNS · Threads 콘텐츠");
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "threads.followers.read" &&
          capability.action === "read" &&
          capability.requiresApproval === false &&
          capability.status === "available" &&
          capability.scriptPath === "scripts/threads-crud.mjs" &&
          capability.sourceSkillName === "SNS · Threads 콘텐츠",
      ),
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "threads.automation.prepare" &&
          capability.action === "read" &&
          capability.requiresApproval === false &&
          capability.status === "available" &&
          capability.scriptPath === "scripts/threads-crud.mjs" &&
          capability.usage === "node scripts/threads-crud.mjs prepare",
      ),
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "threads.posts.publish" &&
          capability.action === "write" &&
          capability.requiresApproval === true &&
          capability.status === "planned",
      ),
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "threads.posts.update" &&
          capability.action === "write" &&
          capability.requiresApproval === true &&
          capability.status === "planned",
      ),
    );
  } finally {
    await server.close();
  }
});

test("agent integrations list Facebook connector capabilities for installed skills", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-integrations-api-"));
  await mkdir(path.join(stateRoot, "connectors", "facebook"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "facebook", "browser-session.json"),
    JSON.stringify(
      {
        provider: "facebook",
        accountLabel: "Facebook account",
        connectedAt: "2026-05-12T10:00:00.000Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-12T10:05:00.000Z",
    idGenerator: () => "facebook-agent",
  });

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "facebook-agent",
        name: "Facebook Agent",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const agent = createResponse.json<AgentRecord>();

    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/facebook-agent/skills/md-sns-facebook",
      payload: {
        replace: true,
        files: [
          {
            path: "SKILL.md",
            content:
              "---\nname: md-sns-facebook\n---\n# SNS · Facebook 콘텐츠\nUse when the user asks for Facebook content or account checks.\n",
          },
        ],
      },
    });
    assert.equal(installResponse.statusCode, 200);
    await access(
      path.join(
        agent.workspaceRoot,
        ".agents",
        "skills",
        "md-sns-facebook",
        "connector-capabilities.json",
      ),
    );
    await access(
      path.join(
        agent.workspaceRoot,
        ".agents",
        "skills",
        "md-sns-facebook",
        "scripts",
        "facebook-crud.mjs",
      ),
    );

    const integrationsResponse = await server.inject({
      method: "GET",
      url: "/agents/facebook-agent/integrations",
    });
    assert.equal(integrationsResponse.statusCode, 200);
    const integrations =
      integrationsResponse.json<AgentConnectorIntegrationRecord[]>();
    assert.equal(integrations.length, 1);
    assert.equal(integrations[0]?.provider, "facebook");
    assert.equal(integrations[0]?.status, "connected");
    assert.equal(integrations[0]?.browserAccess.status, "granted");
    assert.equal(integrations[0]?.requiredBySkills[0]?.displayName, "SNS · Facebook 콘텐츠");
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "facebook.profile.read" &&
          capability.action === "read" &&
          capability.requiresApproval === false &&
          capability.status === "available" &&
          capability.scriptPath === "scripts/facebook-crud.mjs" &&
          capability.sourceSkillName === "SNS · Facebook 콘텐츠",
      ),
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "facebook.posts.publish" &&
          capability.action === "write" &&
          capability.requiresApproval === true &&
          capability.status === "planned",
      ),
    );
  } finally {
    await server.close();
  }
});

test("agent integrations attach Instagram native Graph API capabilities for installed SNS skills", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-integrations-api-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-21T10:00:00.000Z",
    idGenerator: () => "instagram-agent",
    connectorBaseEnv: INSTAGRAM_GRAPH_ENV,
  });

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "instagram-agent",
        name: "Instagram Agent",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const agent = createResponse.json<AgentRecord>();

    const installResponse = await server.inject({
      method: "PUT",
      url: "/agents/instagram-agent/skills/md-sns-instagram",
      payload: {
        replace: true,
        files: [
          {
            path: "SKILL.md",
            content:
              "---\nname: md-sns-instagram\n---\n# SNS · Instagram 콘텐츠\nUse when the user asks for Instagram feed, Reels, publishing, or insights.\n",
          },
        ],
      },
    });
    assert.equal(installResponse.statusCode, 200);
    await access(
      path.join(
        agent.workspaceRoot,
        ".agents",
        "skills",
        "md-sns-instagram",
        "connector-capabilities.json",
      ),
    );
    await assert.rejects(
      access(
        path.join(
          agent.workspaceRoot,
          ".agents",
          "skills",
          "md-sns-instagram",
          "scripts",
          "instagram-graph.mjs",
        ),
      ),
    );
    const manifest = JSON.parse(
      await readFile(
        path.join(
          agent.workspaceRoot,
          ".agents",
          "skills",
          "md-sns-instagram",
          "connector-capabilities.json",
        ),
        "utf8",
      ),
    );
    const generatedMediaPrepare = manifest.capabilities.find(
      (capability: { id?: string }) =>
        capability.id === "instagram.media.prepare",
    );
    assert.equal(generatedMediaPrepare?.action, "write");
    assert.equal(generatedMediaPrepare?.requiresApproval, true);
    assert.equal(generatedMediaPrepare?.executionOwner, "rocky-server");
    assert.equal(generatedMediaPrepare?.scriptPath, undefined);

    const integrationsResponse = await server.inject({
      method: "GET",
      url: "/agents/instagram-agent/integrations",
    });
    assert.equal(integrationsResponse.statusCode, 200);
    const integrations =
      integrationsResponse.json<AgentConnectorIntegrationRecord[]>();
    assert.equal(integrations.length, 1);
    assert.equal(integrations[0]?.provider, "instagram");
    assert.equal(integrations[0]?.status, "connected");
    assert.equal(integrations[0]?.browserAccess.status, "not-applicable");
    assert.equal(
      integrations[0]?.requiredBySkills[0]?.displayName,
      "SNS · Instagram 콘텐츠",
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "instagram.media.publish" &&
          capability.action === "write" &&
          capability.requiresApproval === true &&
          capability.status === "available" &&
          capability.setupMode === "graph-api" &&
          capability.executionOwner === "rocky-server" &&
          capability.scriptPath === undefined,
      ),
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "instagram.media.prepare" &&
          capability.action === "write" &&
          capability.requiresApproval === true &&
          capability.status === "available" &&
          capability.setupMode === "graph-api" &&
          capability.executionOwner === "rocky-server" &&
          capability.scriptPath === undefined,
      ),
    );
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "instagram.insights.read" &&
          capability.action === "read" &&
          capability.status === "available" &&
          capability.setupMode === "graph-api",
      ),
    );
  } finally {
    await server.close();
  }
});

test("agent integrations repairs existing Threads skills missing connector files", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-integrations-api-"));
  await mkdir(path.join(stateRoot, "connectors", "threads"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "threads", "browser-session.json"),
    JSON.stringify(
      {
        provider: "threads",
        accountLabel: "64342357840",
        connectedAt: "2026-05-10T11:30:00.000Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-10T12:00:00.000Z",
    idGenerator: () => "threads-agent",
  });

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "threads-agent",
        name: "Threads Agent",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const agent = createResponse.json<AgentRecord>();
    const skillDir = path.join(
      agent.workspaceRoot,
      ".agents",
      "skills",
      "md-sns-threads-legacy",
    );
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: md-sns-threads-legacy\n---\n# SNS · Threads 콘텐츠\n",
    );

    const integrationsResponse = await server.inject({
      method: "GET",
      url: "/agents/threads-agent/integrations",
    });
    assert.equal(integrationsResponse.statusCode, 200);
    const integrations =
      integrationsResponse.json<AgentConnectorIntegrationRecord[]>();
    assert.ok(
      integrations[0]?.capabilities.some(
        (capability) =>
          capability.id === "threads.followers.read" &&
          capability.scriptPath === "scripts/threads-crud.mjs",
      ),
    );
    await access(path.join(skillDir, "connector-capabilities.json"));
    await access(path.join(skillDir, "scripts", "threads-crud.mjs"));
    await access(
      path.join(
        agent.runtimeHome,
        ".codex",
        "skills",
        "md-sns-threads-legacy",
        "scripts",
        "threads-crud.mjs",
      ),
    );
  } finally {
    await server.close();
  }
});
