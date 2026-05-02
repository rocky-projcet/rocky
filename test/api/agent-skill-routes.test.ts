import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";

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
