# Issue 34 Instagram Draft/Publish Completion Scope

## Product Decision

Issue #34 no longer requires real Instagram publishing to be delegated to a
verified external public execution skill.

Rocky's native Instagram Graph API integration is now the accepted execution
owner for the MVP because the Graph API account connection and server-managed
publish capabilities are available.

The stronger server-owned approval flow is moved to a follow-up issue. The
current MVP may rely on the existing publish request handoff as long as the
remaining #34 behavior is documented clearly and sensitive data stays protected.

## What Can Close Issue #34

Issue #34 can be treated as functionally complete when this branch demonstrates:

1. Instagram feed/Reels draft creation works without requiring an Instagram
   account connection.
2. Publish connection is available only when Rocky reports an available native
   Instagram Graph API publish capability.
3. Publishing goes through Rocky's server-managed Graph API capability, not an
   agent-run local script or raw connector endpoint call.
4. Publish success returns only safe status fields and public result URLs.
5. Publish failures are understandable and do not expose tokens, env values,
   raw requests/responses, cookies, storage state, or browser profile paths.
6. Backend/API/Web tests cover the draft and publish MVP behavior.

## Follow-Up Issue

Create a separate follow-up issue for explicit user approval hardening.

That follow-up should include:

1. Add a server-owned publish approval request state.
2. Do not execute Instagram write actions solely from boolean fields written by
   an agent in `instagram-publish-request.json`.
3. Require a user UI/API approval event before final publish execution.
4. Recheck approval state, request/media/caption identity, approval expiry,
   connected account state, and publish capability state immediately before
   execution.
5. Move public media URL preparation fully into the publish approval flow so
   draft-only requests do not depend on `tmpfiles.org` uploads.

## Publication Notes

Before closing #34, update the issue or PR description to record the scope
change:

- Removed requirement: verified external public execution skill.
- Accepted replacement: Rocky native Instagram Graph API execution.
- Deferred hardening: server-owned explicit publish approval follow-up.

Keep transient files such as `.pi-agent/` and `debug.log` out of commits.

## Validation

Use the standard checks:

- `npm run typecheck`
- `npm run web:typecheck`
- `npm test`
- `npm run web:build`
