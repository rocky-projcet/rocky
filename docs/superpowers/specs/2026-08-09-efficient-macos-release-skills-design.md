# Efficient macOS Release Skills

## Goal

Prevent repeated Rocky macOS packaging, installation, full-suite, and UI-automation loops while preserving one trustworthy end-to-end verification.

## Scope

- Update `rocky-release` with an artifact-first macOS fast path.
- Update `rocky-electron-desktop-chrome` with bounded native UI smoke guidance.
- Do not add a new skill, helper script, or generic workflow abstraction.

## Rules

1. Inspect the real Electron app tree and `pkgbuild --analyze` component plist before changing packaging code.
2. Put bundle metadata, helper names, relative symlinks, fixed install location, and exact main-process identity in the initial acceptance checklist.
3. During iteration, run the smallest relevant tests. Run the full suite once against the final tree.
4. Build and install only after focused checks pass; rebuild after a later change only when it affects packaged contents or the packaging pipeline.
5. Use the required execution permissions immediately for checks known to bind local ports or invoke macOS packaging tools.
6. Attempt unsupported Dock or Command-Tab automation once, then leave the app running and hand the visual check to the user.

## Validation

- Validate each skill independently before editing the next.
- Confirm YAML/frontmatter validity and inspect the diff for concise, non-narrative guidance.
- Forward-test the guidance against a fresh macOS branding/install scenario without revealing the intended answer.
