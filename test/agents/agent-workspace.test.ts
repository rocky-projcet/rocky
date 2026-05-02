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
  assert.equal(skills[0]?.displayName, "Local Helper");
  assert.equal(skills[0]?.invocation, "$local-helper");
  assert.match(overlay, /- Local Helper: Agent-local skill\./);
  assert.match(overlay, /User-facing agent skills/);
  assert.match(
    overlay,
    /report only the skill display names above/u
  );
  assert.match(
    overlay,
    /Do not expose internal skill identifiers, invocation strings, file paths/u
  );
  assert.match(
    overlay,
    /inspect its directory under `.agents\/skills`, read its `SKILL\.md`/u
  );
  assert.match(
    overlay,
    /Generic file searches may skip hidden skill directories/u
  );
  assert.doesNotMatch(overlay, /\*\*System \(read-only\)\*\*/);
  assert.doesNotMatch(overlay, /openai-docs: OpenAI 제품\/API/u);
  assert.doesNotMatch(overlay, /\$local-helper/u);
  assert.match(
    overlay,
    /Repository-root developer skills from parent directories are development-only and unavailable/u
  );
  assert.doesNotMatch(overlay, /\$system-reporter/u);
  assert.doesNotMatch(overlay, /\$\.system/u);
});

test("workspace-local overlay includes skill titles and descriptions", async () => {
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-workspace-skill-metadata-")
  );
  const skillRoot = path.join(workspaceRoot, ".agents", "skills", "md-document-1rhh6bd");

  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: md-document-1rhh6bd",
      'description: "Use when running the saved 특허 리서치 workflow."',
      "---",
      "",
      "# 특허 리서치",
      "",
    ].join("\n")
  );

  const skills = await listWorkspaceLocalSkills(workspaceRoot);
  const overlay = buildWorkspaceAgentsOverlay(workspaceRoot, skills);

  assert.equal(skills[0]?.name, "md-document-1rhh6bd");
  assert.equal(skills[0]?.displayName, "특허 리서치");
  assert.equal(
    skills[0]?.description,
    "Use when running the saved 특허 리서치 workflow."
  );
  assert.match(
    overlay,
    /- 특허 리서치: Use when running the saved 특허 리서치 workflow\./u
  );
  assert.doesNotMatch(overlay, /\$md-document-1rhh6bd/u);
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
