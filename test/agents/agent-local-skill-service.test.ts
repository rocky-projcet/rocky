import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { AgentManager } from "../../src/agents/agent-manager.js";
import { AgentLocalSkillService } from "../../src/agents/agent-local-skill-service.js";
import { resolveWorkspaceScaffoldPaths } from "../../src/agents/agent-workspace.js";

test("AgentLocalSkillService deletes only agent-local canonical and legacy skill dirs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-local-skills-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "skill-agent",
    now: () => "2026-04-26T00:00:00.000Z",
  });
  const agent = await manager.createAgent({
    name: "skill-agent",
  });
  const paths = resolveWorkspaceScaffoldPaths(agent.workspaceRoot);
  const service = new AgentLocalSkillService();

  await mkdir(path.join(paths.skillsDir, "slides"), { recursive: true });
  await writeFile(path.join(paths.skillsDir, "slides", "SKILL.md"), "---\nname: slides\n---\n");
  await mkdir(path.join(paths.legacySkillsDir, "legacy-only"), { recursive: true });
  await writeFile(
    path.join(paths.legacySkillsDir, "legacy-only", "SKILL.md"),
    "---\nname: legacy-only\n---\n"
  );

  const listed = await service.listAgentLocalSkills(agent);
  assert.deepEqual(
    listed.map((skill) => skill.id).sort(),
    ["legacy-only", "slides"]
  );
  await access(path.join(paths.skillsDir, "legacy-only", "SKILL.md"));

  const deleted = await service.deleteAgentLocalSkill(agent, "legacy-only");
  assert.equal(deleted.deleted, true);
  assert.deepEqual(
    deleted.skills.map((skill) => skill.id),
    ["slides"]
  );
  await assert.rejects(access(path.join(paths.skillsDir, "legacy-only")));
  await assert.rejects(access(path.join(paths.legacySkillsDir, "legacy-only")));
  await access(path.join(paths.skillsDir, "slides", "SKILL.md"));
});

test("AgentLocalSkillService rejects traversal, reserved, and protected skill ids", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-local-skills-policy-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "policy-agent",
    now: () => "2026-04-26T00:00:00.000Z",
  });
  const agent = await manager.createAgent({
    name: "policy-agent",
  });
  const service = new AgentLocalSkillService();

  await assert.rejects(
    service.deleteAgentLocalSkill(agent, "../outside"),
    /single path segment/
  );
  await assert.rejects(
    service.deleteAgentLocalSkill(agent, "openai-docs"),
    /Reserved system skill/
  );
  await assert.rejects(
    service.deleteAgentLocalSkill(agent, "rocky.core", {
      protectedSkillIds: ["rocky.core"],
    }),
    /Protected agent skill/
  );
});
