# Issue 34 Instagram Draft/Publish Completion Plan

## Context

Issue #34 is not functionally complete yet. The current branch passes type checks,
unit tests, and web build checks, but the implementation still needs to close the
product requirements around external publish execution skills, server-owned user
approval, draft-only behavior, and sensitive-data handling.

## Plan

1. Clarify the publish execution owner.
   - Keep the issue #34 requirement that real publishing is allowed only through a verified external public Instagram publish execution skill.
   - If the product decision is to keep Rocky backend native Graph publishing instead, update issue #34 acceptance criteria before marking the issue complete.

2. Add a server-owned user approval model.
   - Do not execute publish actions solely from boolean fields written by an agent in `instagram-publish-request.json`.
   - Have Rocky create and store an approval request state.
   - Execute publishing only after the user explicitly approves through UI/API.
   - Recheck approval state, request/media/caption identity, approval expiry, connected account state, and publish capability state immediately before execution.

3. Re-align the publish gate with verified external execution skills.
   - Stop treating any available `instagram.media.publish` backend capability as sufficient for the template publish option.
   - Gate `발행까지 연결하기` on a verified external public skill, account binding readiness, manifest safety checks, endpoint allowlists, and per-run approval policy.
   - Keep `초안만 만들기` available regardless of Instagram account state.

4. Separate public media upload from draft creation.
   - Do not upload media to `tmpfiles.org` from Instagram/feed/reels keywords alone.
   - Draft creation should use local workspace attachments only.
   - Create public media URLs only when the user has selected publish connection and entered the approval flow.
   - Public media URL preparation failures must not block draft-only generation.

5. Tighten sensitive-data handling.
   - Verify that tokens, env values, raw requests/responses, cookies, storage state, and browser profile paths do not appear in UI responses, prompts, logs, artifacts, or publish request/result files.
   - Keep error messages actionable by separating auth, permission, manifest validation, API execution, and public media preparation failures without exposing secrets.

6. Strengthen tests.
   - Server approval absent: no Instagram write action runs even if `instagram-publish-request.json` exists.
   - Agent-authored approval booleans alone do not trigger publishing.
   - No verified external publish execution skill: UI disables publish connection and server keeps draft-only behavior.
   - Draft-only Instagram request with media does not upload to `tmpfiles.org`.
   - Publish approval flow prepares a public media URL or reports a safe, specific preparation failure.
   - Publish success and failure return only safe status/URL fields and do not expose sensitive data.

7. Clean and validate before publication.
   - Exclude transient files such as `.pi-agent/` and `debug.log`.
   - Run `npm run typecheck`.
   - Run `npm run web:typecheck`.
   - Run `npm test`.
   - Run `npm run web:build`.

## Definition of Done

Issue #34 can be marked functionally complete only when:

- Instagram feed/Reels drafts can be created without an account, external publish skill, or public upload.
- Real publishing is possible only after a verified external execution skill and server-owned user approval are present.
- Sensitive data is not exposed through UI, API, prompts, logs, or artifacts.
- The behavior is covered by backend/API/Web tests.
