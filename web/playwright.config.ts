import { defineConfig } from "@playwright/test";

const backendPort = 3200;
const webPort = 4273;

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command: `node ../scripts/run-dev-stack.mjs --skip-install --state-root .runtime/playwright --backend-port ${backendPort} --web-port ${webPort}`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
