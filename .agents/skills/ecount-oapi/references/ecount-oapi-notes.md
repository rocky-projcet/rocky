# ECOUNT OAPI Notes

## Manual Findings

- The Korean manual route is usually opened after web login from a URL like:
  `https://sboapicc.ecount.com/ECERP/OAPIView/OAPIManual?lan_type=ko-KR&ec_req_sid=...`
- The manual's direct-run pretest form labels `API_CERT_KEY` as the test authentication key.
- The manual says `USER_ID` is the ECOUNT ID that issued the test key.
- The manual shows:
  - Test Zone: `https://sboapi.ecount.com/OAPI/V2/Zone`
  - Test Login: `https://sboapi{ZONE}.ecount.com/OAPI/V2/OAPILogin`
- The manual UI may actually post Zone/Login to internal 5.0 action URLs:
  - `https://sboapilx{ZONE}.ecount.com/ec5/api/app.oapi/action/OAPIGetZoneAction`
  - `https://sboapilx{ZONE}.ecount.com/ec5/api/app.oapi/action/OAPILoginAction`

## Payloads

Zone:

```json
{
  "COM_CODE": "..."
}
```

OAPILogin:

```json
{
  "ZONE": "CC",
  "COM_CODE": "...",
  "USER_ID": "key issuer id",
  "API_CERT_KEY": "...",
  "LAN_TYPE": "ko-KR",
  "ISTEST": "Y"
}
```

Some manual UI versions send `LAN_TYPE` as the literal template string `<%=lan_type%>`. If `ko-KR` fails unexpectedly, retry with the literal before concluding the key is invalid.

## Troubleshooting

- `Data.Code = 201`, `API_CERT_KEY is not valid`: most often means `USER_ID` does not match the test key's issuing ID. Check the test-key row in the API status tab.
- `Data.Code = 205` or an IP message: register the current outbound IP from the API key issue page's IP registration button.
- `Status = 412`: can indicate test-server transmission/rate restrictions. Avoid repeated blind retries.
- A valid test key row has a visible issuer ID, API key, and validity period.
- Keep web-login credentials and API issuer ID separate in app config, for example `USER_ID` for web login and `API_USER_ID` for OAPILogin.
