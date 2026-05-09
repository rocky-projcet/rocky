# ECOUNT OAPI Notes

## Manual Findings

- The Korean manual route is usually opened after web login from a URL like:
  `https://sboapicc.ecount.com/ECERP/OAPIView/OAPIManual?lan_type=ko-KR&ec_req_sid=...`
- `ec_req_sid` is tied to the current ERP web session. If a copied manual URL redirects to login, log in again and replace `ec_req_sid` with the fresh value.
- Detailed manual pages are loaded from routes like `/ECERP/OAPI/ViewLoginApi?lan_type=ko-KR`; use the scraper with `--include-pages` to extract them into `manual-pages.md`.
- The manual's direct-run pretest form labels `API_CERT_KEY` as the test authentication key.
- The manual says `USER_ID` is the ECOUNT ID that issued the test key.
- Test-key/prevalidation hosts use `sboapi`; production hosts use `oapi`.
- The OpenAPI URL table shows:
  - Production Zone: `https://oapi.ecount.com/OAPI/V2/Zone`
  - Production Login: `https://oapi{ZONE}.ecount.com/OAPI/V2/OAPILogin`
  - Production data APIs: `https://oapi{ZONE}.ecount.com/...?...SESSION_ID={SESSION_ID}`
- The "Open API usage" page says test validation requests go to `http://sboapi.ecount.com`; use HTTPS for standalone scripts when accepted.
- The manual UI may actually post Zone/Login to internal 5.0 action URLs:
  - `https://sboapilx{ZONE}.ecount.com/ec5/api/app.oapi/action/OAPIGetZoneAction`
  - `https://sboapilx{ZONE}.ecount.com/ec5/api/app.oapi/action/OAPILoginAction`
- The direct-run JavaScript sends data API sessions as `?session_Id=...`, while the URL table uses `?SESSION_ID=...`; retry the other casing when a session parameter is suspected.

## Lifecycle and Limits

- Test authentication keys are valid for 2 weeks.
- Test key renewal is allowed up to 3 times; additional renewal needs review.
- Production authentication keys are valid for 1 year and can be issued only by the ECOUNT master ID.
- OAPI IP registration is required before validating with a key; up to 5 IPs can be registered.
- API direct execution is for sending JSON pretests and uses test-server limits, but the manual says it does not complete development validation.
- Session IDs are issued by OAPILogin and are valid for the ERP auto-logout duration. The manual specifically notes order or sale API calls extend the configured timeout.
- Manual rate guidance includes:
  - Zone/Login: production `1 request / 10 min`, test server `1 request / 10 sec`.
  - Single-record lookup APIs: `1 request / 1 sec`.
  - The general table lists hourly continuous-error limit `30`, one-call maximum quantity `300`, and daily maximum quantity `5000`; individual API responses also return `QUANTITY_INFO`, so prefer the live response for the exact current allowance.
- The Zone/Login pages warn that 10 or more repeated Zone/Login failures from the same IP can restrict both Open API and ERP login access.

## Available Production API URLs

Use `oapi{ZONE}` for production and `sboapi{ZONE}` for test/prevalidation.

| Menu | Path |
| --- | --- |
| Zone | `/OAPI/V2/Zone` |
| Login | `/OAPI/V2/OAPILogin` |
| 거래처등록 | `/OAPI/V2/AccountBasic/SaveBasicCust` |
| 품목등록 | `/OAPI/V2/InventoryBasic/SaveBasicProduct` |
| 품목조회(단건) | `/OAPI/V2/InventoryBasic/ViewBasicProduct` |
| 품목조회 | `/OAPI/V2/InventoryBasic/GetBasicProductsList` |
| 견적서입력 | `/OAPI/V2/Quotation/SaveQuotation` |
| 주문서입력 | `/OAPI/V2/SaleOrder/SaveSaleOrder` |
| 판매입력 | `/OAPI/V2/Sale/SaveSale` |
| 발주서조회 | `/OAPI/V2/Purchases/GetPurchasesOrderList` |
| 구매입력 | `/OAPI/V2/Purchases/SavePurchases` |
| 작업지시서입력 | `/OAPI/V2/JobOrder/SaveJobOrder` |
| 생산불출입력 | `/OAPI/V2/GoodsIssued/SaveGoodsIssued` |
| 생산입고 I | `/OAPI/V2/GoodsReceipt/SaveGoodsReceipt` |
| 매출·매입전표 II 자동분개 | `/OAPI/V2/InvoiceAuto/SaveInvoiceAuto` |
| 재고현황(단건) | `/OAPI/V2/InventoryBalance/ViewInventoryBalanceStatus` |
| 재고현황 | `/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus` |
| 창고별재고현황(단건) | `/OAPI/V2/InventoryBalance/ViewInventoryBalanceStatusByLocation` |
| 창고별재고현황 | `/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatusByLocation` |
| 주문API(쇼핑몰관리) | `/OAPI/V2/OpenMarket/SaveOpenMarketOrderNew` |
| 출/퇴근기록부(사원) | `/OAPI/V2/TimeMgmt/SaveClockInOut` |
| 게시판입력 | `/ec5/api/app.oapi.v3/action/CreateOApiBoardAction` |

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

Data APIs:

- Append the session ID query parameter. Manual table uses `SESSION_ID`; direct-run JS uses `session_Id`.
- Most save/input APIs use a top-level list wrapper and `BulkDatas`, for example `ProductList`, `CustList`, `SaleList`, `PurchasesList`, `JobOrderList`, `GoodsIssuedList`, `GoodsReceiptList`, `InvoiceAutoList`, or `ClockInOutList`.
- Required fields can vary by company form settings. The manual repeatedly says company-specific ERP "required" or "form required" settings must be checked in the corresponding ERP input screen.
- Fields not added to the ERP upload/input form may be ignored rather than saved.

## Troubleshooting

- `Data.Code = 201`, `API_CERT_KEY is not valid`: most often means `USER_ID` does not match the test key's issuing ID. Check the test-key row in the API status tab.
- `Data.Code = 204`: test key vs production server or production key vs test server mismatch.
- `Data.Code = 205` or an IP message: register the current outbound IP from the API key issue page's IP registration button.
- Login codes `20`/`99` point to incorrect or unknown login identity; codes `24`/`25` point to personal/company IP restrictions.
- `Status = 412`: can indicate test-server transmission/rate restrictions. Avoid repeated blind retries.
- HTTP `302` can also indicate API transmission limit handling.
- HTTP `404` means a wrong API path.
- HTTP `500` can indicate internal service error, `Transfer-Encoding: chunked`, validation failures, continuous-error/max-quantity limits, or session timeout depending on the response body.
- ECOUNT expects standard JSON and `Content-Type: application/json`; invalid JSON yields `Model validation state error`, and wrong content type yields `Unsupported Media Type`.
- Include `TRACE_ID` when asking ECOUNT support about errors.
- A valid test key row has a visible issuer ID, API key, and validity period.
- Keep web-login credentials and API issuer ID separate in app config, for example `USER_ID` for web login and `API_USER_ID` for OAPILogin.
