# Efficient macOS Release Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Rocky's release and Electron desktop skills to reach one reliable macOS package/install verification without avoidable rebuild, full-suite, or UI-automation loops.

**Architecture:** Keep the guidance in the two existing repo-local skills. Add a positive artifact-first recipe to `rocky-release`, then add bounded native smoke rules to `rocky-electron-desktop-chrome`; validate each skill before touching the next.

**Tech Stack:** Markdown `SKILL.md`, YAML frontmatter, Codex skill validation.

## Global Constraints

- Add no new skill, helper script, or workflow abstraction.
- Use the current issue-131 execution trace as the observed failing baseline.
- Keep each addition concise, imperative, and reusable rather than narrating this incident.
- Validate one skill completely before editing the next.

---

### Task 1: Artifact-first Rocky release guidance

**Files:**
- Modify: `.agents/skills/rocky-release/SKILL.md`

**Interfaces:**
- Consumes: the existing release workflow and issue-131 failure trace.
- Produces: a macOS fast path used before packaging or installing Rocky artifacts.

- [ ] **Step 1: Record the observed failure**

Confirm the baseline trace shows repeated package/install loops caused by inspecting synthetic assumptions after implementation instead of the real Electron bundle and `pkgbuild --analyze` plist first.

- [ ] **Step 2: Add the minimal recipe**

Add a compact macOS section that requires: real artifact inspection, one initial acceptance checklist, focused tests during iteration, one final full suite, delayed packaging/install, conditional rebuilds, and immediate use of known required permissions.

- [ ] **Step 3: Validate the skill**

Run the skill validator against `.agents/skills/rocky-release`, inspect `git diff --check`, and forward-test a fresh macOS release scenario for an artifact-first sequence.

- [ ] **Step 4: Commit**

Commit only the validated `rocky-release` change.

### Task 2: Bounded Electron native smoke guidance

**Files:**
- Modify: `.agents/skills/rocky-electron-desktop-chrome/SKILL.md`

**Interfaces:**
- Consumes: the artifact-first package produced by Task 1.
- Produces: deterministic bundle/process checks plus a bounded visual handoff.

- [ ] **Step 1: Record the observed failure**

Confirm the baseline trace shows repeated Dock automation attempts and false-positive process matching risk.

- [ ] **Step 2: Add the minimal recipe**

Require checks for Rocky metadata, four helper bundles, relative symlinks, fixed install location, and an exact main-process command. Limit unsupported Dock or Command-Tab automation to one attempt before leaving the app open for user acceptance.

- [ ] **Step 3: Validate the skill**

Run the skill validator against `.agents/skills/rocky-electron-desktop-chrome`, inspect `git diff --check`, and forward-test a fresh installed-app smoke scenario for bounded automation and exact process matching.

- [ ] **Step 4: Commit**

Commit only the validated Electron skill change.

### Task 3: Final scope check

**Files:**
- Verify: `.agents/skills/rocky-release/SKILL.md`
- Verify: `.agents/skills/rocky-electron-desktop-chrome/SKILL.md`

- [ ] **Step 1: Verify scope and concision**

Confirm no other skill, script, or product code changed and both additions directly address the observed inefficiencies.

- [ ] **Step 2: Report validation evidence**

Report the two skill validator results, forward-test outcomes, and final clean diff status.
