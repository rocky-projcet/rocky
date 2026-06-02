import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  EcountSalesExcelExportService,
  readEcountWebLoginInputFromEnv,
  type EcountSalesBrowserAutomationInput,
} from "../../src/integrations/ecount-browser-sales-export.js";

test("ECOUNT sales Excel export uses a managed browser-download boundary", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "ecount-sales-export-"));
  let received: EcountSalesBrowserAutomationInput | null = null;
  const service = new EcountSalesExcelExportService({
    now: () => "2026-06-02T03:04:05.000Z",
    automation: {
      async exportSalesExcel(input) {
        received = input;
        const filePath = path.join(input.outputDir, input.suggestedFileName);
        await writeFile(filePath, Buffer.from("fake-xlsx"));
        return {
          downloadedFilePath: filePath,
          fileName: path.basename(filePath),
          pageUrl: "https://logincc.ecount.com/ec5/view/erp?ec_req_sid=session-secret#prgId=E040206",
        };
      },
    },
  });

  const result = await service.exportSalesExcel({
    login: {
      accountLabel: "본사 이카운트",
      comCode: "secret-com",
      userId: "secret-user",
      password: "secret-password",
    },
    outputDir,
    fromDate: "2026-06-01",
    toDate: "2026/06/02",
    customerCode: " C001 ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "downloaded");
  assert.equal(result.programId, "E040206");
  assert.equal(result.filters.fromDate, "20260601");
  assert.equal(result.filters.toDate, "20260602");
  assert.equal(result.filters.customerCode, "C001");
  assert.equal(result.fileName, "ecount-sales-20260601-20260602-20260602030405.xlsx");
  assert.equal(result.byteSize, 9);
  assert.equal(result.downloadedFilePath?.startsWith(path.resolve(outputDir)), true);
  assert.equal(result.pageUrl?.includes("session-secret"), false);
  assert.equal(received?.login.password, "secret-password");
  assert.equal(received?.headless, true);
  assert.equal(received?.channel, "msedge");

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-com"), false);
  assert.equal(serialized.includes("secret-user"), false);
  assert.equal(serialized.includes("secret-password"), false);
});

test("ECOUNT sales Excel export redacts credentials from failure diagnostics", async () => {
  const service = new EcountSalesExcelExportService({
    now: () => "2026-06-02T00:00:00.000Z",
    automation: {
      async exportSalesExcel(input) {
        throw new Error(
          `login failed for ${input.login.comCode}/${input.login.userId}/${input.login.password}`
        );
      },
    },
  });

  const result = await service.exportSalesExcel({
    login: {
      comCode: "secret-com",
      userId: "secret-user",
      password: "secret-password",
    },
    fromDate: "2026-06-02",
    toDate: "2026-06-02",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.match(result.diagnostics?.detail ?? "", /\[REDACTED\]/u);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-com"), false);
  assert.equal(serialized.includes("secret-user"), false);
  assert.equal(serialized.includes("secret-password"), false);
});

test("ECOUNT sales Excel export rejects downloads outside the managed output directory", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "ecount-sales-managed-"));
  const outsidePath = path.join(await mkdtemp(path.join(os.tmpdir(), "ecount-sales-outside-")), "sales.xlsx");
  const service = new EcountSalesExcelExportService({
    now: () => "2026-06-02T00:00:00.000Z",
    automation: {
      async exportSalesExcel() {
        await writeFile(outsidePath, Buffer.from("fake-xlsx"));
        return {
          downloadedFilePath: outsidePath,
          fileName: "sales.xlsx",
          pageUrl: "https://logincc.ecount.com/ec5/view/erp#prgId=E040206",
        };
      },
    },
  });

  const result = await service.exportSalesExcel({
    login: {
      comCode: "secret-com",
      userId: "secret-user",
      password: "secret-password",
    },
    outputDir,
    fromDate: "2026-06-02",
    toDate: "2026-06-02",
  });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics?.stage, "download");
  assert.equal(result.downloadedFilePath, null);
});

test("ECOUNT web login env reader uses web credential aliases", () => {
  const env = {
    ECOUNT_ERP_ACCOUNT_LABEL: "본사",
    ECOUNT_ERP_COM: " web-com ",
    ECOUNT_ERP_ID: " web-user ",
    ECOUNT_ERP_PW: " web-password ",
    ECOUNT_ERP_LAN_TYPE: "ko-KR",
  } as NodeJS.ProcessEnv;

  assert.deepEqual(readEcountWebLoginInputFromEnv(env), {
    accountLabel: "본사",
    comCode: "web-com",
    userId: "web-user",
    password: "web-password",
    lanType: "ko-KR",
  });
});
