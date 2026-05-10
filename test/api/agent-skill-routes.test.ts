import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";
import type { AgentConnectorIntegrationRecord } from "../../src/connectors/connector-types.js";

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
