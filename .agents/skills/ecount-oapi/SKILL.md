---
name: ecount-oapi
description: Verify and troubleshoot ECOUNT ERP Open API/OAPI integration. Use when Codex needs to log in to ECOUNT with .env credentials, inspect the Korean OAPI manual, validate test API keys, resolve API_CERT_KEY or USER_ID failures, run Zone/OAPILogin/session smoke tests, register or check OAPI IP guidance, or perform read-only ECOUNT API connectivity checks without exposing secrets.
---

# ECOUNT OAPI

## Goal

Validate ECOUNT ERP OAPI access end to end while keeping credentials out of logs. Prefer read-only checks unless the user explicitly asks to create or mutate ERP data.

## Required Inputs

Read credentials from `.env`; never echo raw values.

- Web login: `COM_CODE`/`USER_ID`/`PW`, or repo aliases `ECOUNT_ERP_COM`/`ECOUNT_ERP_ID`/`ECOUNT_ERP_PW`.
- OAPI key: `API_CERT_KEY`, or aliases `ECOUNT_API_CERT_KEY`, `ECOUNT_OAPI_CERT_KEY`, `ECOUNT_ERP_API_CERT_KEY`.
- Optional OAPI issuer: `API_USER_ID`, `OAPI_USER_ID`, `ECOUNT_API_USER_ID`, or `ECOUNT_OAPI_USER_ID`. Use this for OAPILogin when present.
- Keep web login ID and OAPI issuer ID separate. The Login payload `USER_ID` is the ID that issued the API key, which can differ from the web-login ID used to open the manual.

## Workflow

1. Confirm web/manual access when needed.
- Log in through `https://login.ecount.com/Login/?lan_type=ko-KR`.
- Open the OAPI manual after login. A copied manual URL contains an `ec_req_sid`; treat it as session-scoped and replace it with a fresh login session ID when it redirects to the login page.
- Prefer the bundled scraper when updating this skill from the Korean manual:
```bash
node .agents/skills/ecount-oapi/scripts/ecount-oapi-manual-scrape.mjs --env .env --url '<manual-url>' --out-dir /tmp/ecount-oapi-manual --include-pages
```
- Read `/tmp/ecount-oapi-manual/manual-pages.md` for the extracted menu pages. The scraper redacts ERP session IDs and does not print credential values.
- Do not treat unauthenticated manual redirects as API failures.

2. Use the test endpoints from the manual.
- Test/prevalidation Zone: `https://sboapi.ecount.com/OAPI/V2/Zone`
- Test/prevalidation Login: `https://sboapi{ZONE}.ecount.com/OAPI/V2/OAPILogin`
- Production Zone: `https://oapi.ecount.com/OAPI/V2/Zone`
- Production Login: `https://oapi{ZONE}.ecount.com/OAPI/V2/OAPILogin`
- Production data APIs use `https://oapi{ZONE}.ecount.com/...`; test-key development uses the `sboapi` host family.
- The manual URL table shows `?SESSION_ID={SESSION_ID}` for data APIs, while the manual's direct-run JavaScript sends `?session_Id=...`. If one casing fails unexpectedly, retry the other before concluding the session is invalid.
- The manual UI may internally call `sboapilx{ZONE}.ecount.com/ec5/api/app.oapi/action/...`; that is equivalent for its own test UI, but prefer the displayed test endpoint for standalone smoke scripts.

3. Validate the key issuer ID before blaming the key.
- The Login payload `USER_ID` must be the ID that issued the test key, not necessarily the current web login ID.
- If Login returns `Data.Code = 201` with `API_CERT_KEY is not valid`, check the ECOUNT API key issue page, API status tab, and test-key section.
- Match the row by `API_CERT_KEY`, then use that row's issuer ID as the OAPI `USER_ID`.
- Login code `204` means test/production key/server mismatch. Code `205` means the outbound IP is not registered.

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
- Repeated failed Zone/Login attempts can trigger blocking. The manual says 10 or more repeated Zone/Login failures from the same IP can restrict Open API and ERP login access. Stop after a few consistent failures and alert the operator.

## Manual Rules To Preserve

- Test keys are valid for 2 weeks and can be renewed up to 3 times before review. Production API keys are valid for 1 year and can be issued only by the ECOUNT master ID.
- Register the OAPI outbound IP before validation. The manual allows up to 5 registered IPs.
- API direct execution is for pretest requests only; do not assume it completes development validation.
- Session IDs come from OAPILogin and remain valid for the ERP auto-logout duration. The manual notes order/sale API calls extend the configured timeout; otherwise a new login is required after expiry.
- Always send JSON with `Content-Type: application/json`. ECOUNT rejects non-standard JSON such as single quotes and reports invalid JSON as `Model validation state error`.
- Do not send `Transfer-Encoding: chunked`; the manual says SSE/chunked transfer is not supported.
- Include ECOUNT `TRACE_ID` when escalating API errors to ECOUNT support.

## References

Read [references/ecount-oapi-notes.md](references/ecount-oapi-notes.md) before changing endpoint selection, payload fields, or failure interpretation.
