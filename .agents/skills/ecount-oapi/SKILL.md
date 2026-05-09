---
name: ecount-oapi
description: Verify and troubleshoot ECOUNT ERP Open API/OAPI integration. Use when Codex needs to log in to ECOUNT with .env credentials, inspect the Korean OAPI manual, validate test API keys, resolve API_CERT_KEY or USER_ID failures, run Zone/OAPILogin/session smoke tests, register or check OAPI IP guidance, or perform read-only ECOUNT API connectivity checks without exposing secrets.
---

# ECOUNT OAPI

## Goal

Validate ECOUNT ERP OAPI access end to end while keeping credentials out of logs. Prefer read-only checks unless the user explicitly asks to create or mutate ERP data.

## Required Inputs

Read credentials from `.env`; never echo raw values.

- `COM_CODE`: ECOUNT company code.
- `USER_ID`: web login ID. This may differ from the OAPI key issuer ID.
- `PW`: web login password, needed for manual/API key status page access.
- `API_CERT_KEY`: test API key from ECOUNT.
- Optional `API_USER_ID` or `OAPI_USER_ID`: the issuing ID for `API_CERT_KEY`. Use this for OAPILogin when present.

## Workflow

1. Confirm web/manual access when needed.
- Log in through `https://login.ecount.com/Login/?lan_type=ko-KR`.
- Open the OAPI manual after login.
- Do not treat unauthenticated manual redirects as API failures.

2. Use the test endpoints from the manual.
- Zone: `https://sboapi.ecount.com/OAPI/V2/Zone`
- Login: `https://sboapi{ZONE}.ecount.com/OAPI/V2/OAPILogin`
- The manual UI may internally call `sboapilx{ZONE}.ecount.com/ec5/api/app.oapi/action/...`; that is equivalent for its own test UI, but prefer the displayed test endpoint for standalone smoke scripts.

3. Validate the key issuer ID before blaming the key.
- The Login payload `USER_ID` must be the ID that issued the test key, not necessarily the current web login ID.
- If Login returns `Data.Code = 201` with `API_CERT_KEY is not valid`, check the ECOUNT API key issue page, API status tab, and test-key section.
- Match the row by `API_CERT_KEY`, then use that row's issuer ID as the OAPI `USER_ID`.

4. Run the smoke test.
- Prefer the bundled script:
```bash
node .agents/skills/ecount-oapi/scripts/ecount-oapi-smoke.mjs --env .env --discover-issuer
```
- Use `--no-read-api` if only Zone/Login should be checked.
- The script prints status summaries only and redacts session IDs and credentials.

5. Interpret common results.
- Zone success returns `Data.ZONE`, usually `CC` for CC-company accounts.
- Login success returns `Data.Code = 00` and a `SESSION_ID`.
- Read-only smoke uses `InventoryBasic/GetBasicProductsList?session_Id=[SESSION_ID]`.
- Error `205` means the current outbound IP is not registered; use the ECOUNT API key issue page's IP registration button.
- Repeated failed Zone/Login attempts can trigger rate/abuse blocking. Stop after a few consistent failures.

## References

Read [references/ecount-oapi-notes.md](references/ecount-oapi-notes.md) before changing endpoint selection, payload fields, or failure interpretation.
