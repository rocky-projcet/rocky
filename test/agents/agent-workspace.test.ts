import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  buildWorkspaceAgentsOverlay,
  ensureWorkspaceSkillBridge,
  isReservedSystemSkillName,
  listWorkspaceLocalSkills,
} from "../../src/agents/agent-workspace.js";

test("reserved system skill names are rejected from the workspace-local inventory", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-workspace-skills-")
  );
  const skillRoot = path.join(workspaceRoot, ".agents", "skills");

  await mkdir(path.join(skillRoot, "local-helper"), { recursive: true });
  await mkdir(path.join(skillRoot, ".system"), { recursive: true });
  await mkdir(path.join(skillRoot, "system-reporter"), { recursive: true });
  await writeFile(
    path.join(skillRoot, "local-helper", "SKILL.md"),
    "# Local Helper\n"
  );
  await writeFile(path.join(skillRoot, ".system", "SKILL.md"), "# System\n");
  await writeFile(
    path.join(skillRoot, "system-reporter", "SKILL.md"),
    "# System Reporter\n"
  );

  const skills = await listWorkspaceLocalSkills(workspaceRoot);
  const overlay = buildWorkspaceAgentsOverlay(workspaceRoot, skills);

  assert.deepEqual(skills.map((skill) => skill.name), ["local-helper"]);
  assert.match(overlay, /- local-helper: Agent-local workspace skill\./);
  assert.match(overlay, /\*\*System \(read-only\)\*\*/);
  assert.match(overlay, /openai-docs: OpenAI 제품\/API 관련 최신 공식 문서 기반 안내/);
  assert.match(overlay, /Repository-root developer skills are unavailable in agent sessions/);
  assert.doesNotMatch(overlay, /- system-reporter: Agent-local workspace skill\./);
  assert.doesNotMatch(overlay, /- \.system: Agent-local workspace skill\./);
});

test("workspace-local inventory reads legacy skills but prefers .agents/skills", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-workspace-legacy-skills-")
  );
  const canonicalSkillRoot = path.join(workspaceRoot, ".agents", "skills");
  const legacySkillRoot = path.join(workspaceRoot, "skills");

  await mkdir(path.join(canonicalSkillRoot, "shared-helper"), { recursive: true });
  await mkdir(path.join(legacySkillRoot, "shared-helper"), { recursive: true });
  await mkdir(path.join(legacySkillRoot, "legacy-only"), { recursive: true });
  await writeFile(
    path.join(canonicalSkillRoot, "shared-helper", "SKILL.md"),
    "# Shared Helper\n"
  );
  await writeFile(
    path.join(legacySkillRoot, "shared-helper", "SKILL.md"),
    "# Legacy Shared Helper\n"
  );
  await writeFile(
    path.join(legacySkillRoot, "legacy-only", "SKILL.md"),
    "# Legacy Only\n"
  );

  const skills = await listWorkspaceLocalSkills(workspaceRoot);

  assert.deepEqual(skills.map((skill) => skill.name), [
    "legacy-only",
    "shared-helper",
  ]);
  assert.equal(
    skills.find((skill) => skill.name === "shared-helper")?.relativeSkillPath,
    path.join(".agents", "skills", "shared-helper", "SKILL.md")
  );
});

test("ensureWorkspaceSkillBridge migrates legacy skills into .agents/skills", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-workspace-migrate-skills-")
  );
  const legacySkillRoot = path.join(workspaceRoot, "skills", "slides");
  const canonicalSkillPath = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "slides",
    "SKILL.md"
  );

  await mkdir(legacySkillRoot, { recursive: true });
  await writeFile(path.join(legacySkillRoot, "SKILL.md"), "# Slides\n");

  const bridge = await ensureWorkspaceSkillBridge(workspaceRoot);

  await access(canonicalSkillPath);
  assert.equal(await readFile(canonicalSkillPath, "utf8"), "# Slides\n");
  assert.equal(
    bridge.skills.find((skill) => skill.name === "slides")?.relativeSkillPath,
    path.join(".agents", "skills", "slides", "SKILL.md")
  );
});

test("isReservedSystemSkillName matches reserved namespaces only", () => {
  assert.equal(isReservedSystemSkillName(".system"), true);
  assert.equal(isReservedSystemSkillName("system"), true);
  assert.equal(isReservedSystemSkillName("system-reporter"), true);
  assert.equal(isReservedSystemSkillName("openai-docs"), true);
  assert.equal(isReservedSystemSkillName("skill-creator"), true);
  assert.equal(isReservedSystemSkillName("skill-installer"), true);
  assert.equal(isReservedSystemSkillName("local-helper"), false);
});
