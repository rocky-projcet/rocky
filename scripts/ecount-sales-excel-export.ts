#!/usr/bin/env node

import process from "node:process";
import { parseArgs } from "node:util";

import {
  EcountSalesExcelExportService,
  readEcountWebLoginInputFromEnv,
  type EcountBrowserChannel,
} from "../src/integrations/ecount-browser-sales-export.js";
import { loadDotenvFile } from "../src/cli/dotenv.js";

function printUsage(): void {
  process.stdout.write(`Usage: node dist/scripts/ecount-sales-excel-export.js [options]

Read-only Browser Assist smoke for ECOUNT ERP 판매조회(E040206) Excel export.
Credentials are read from .env aliases COM_CODE/USER_ID/PW or ECOUNT_ERP_COM/ECOUNT_ERP_ID/ECOUNT_ERP_PW.

Options:
  --from-date YYYY-MM-DD   Sales lookup start date (defaults to --to-date/today)
  --to-date YYYY-MM-DD     Sales lookup end date (defaults to today)
  --customer-code CODE     Optional customer filter
  --product-code CODE      Optional product filter
  --out-dir PATH           Managed download directory (default .runtime/ecount-browser-assist/sales-excel)
  --program-url URL        Override E040206 route while reusing fresh ec_req_sid
  --channel NAME           chromium, chrome, or msedge (default msedge, fallback chromium)
  --headful                Show the browser window
  --help                   Show this help
`);
}

async function main(): Promise<void> {
  loadDotenvFile();
  const { values } = parseArgs({
    options: {
      "from-date": { type: "string" },
      "to-date": { type: "string" },
      "customer-code": { type: "string" },
      "product-code": { type: "string" },
      "out-dir": { type: "string" },
      "program-url": { type: "string" },
      channel: { type: "string" },
      headful: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printUsage();
    return;
  }

  const channel = normalizeChannel(values.channel);
  const service = new EcountSalesExcelExportService();
  const result = await service.exportSalesExcel({
    login: readEcountWebLoginInputFromEnv(),
    fromDate: values["from-date"],
    toDate: values["to-date"],
    customerCode: values["customer-code"],
    productCode: values["product-code"],
    outputDir: values["out-dir"],
    programUrl: values["program-url"],
    channel,
    headless: !values.headful,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function normalizeChannel(value: string | undefined): EcountBrowserChannel {
  if (!value) return "msedge";
  if (value === "chromium" || value === "chrome" || value === "msedge") {
    return value;
  }
  throw new Error("--channel must be chromium, chrome, or msedge.");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
