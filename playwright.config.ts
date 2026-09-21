import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      DATABASE_PATH: resolve(`test-results/e2e-${process.pid}.db`),
      WRITE_TOKEN: "e2e-write-token",
      LOG_LEVEL: "error",
    },
    timeout: 120000,
  },
});
