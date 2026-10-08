import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

// Artifacts live outside the project: the Next dev server watches the tree and would reload on every trace write.
const ART = process.env.PW_ARTIFACTS ?? path.join(os.tmpdir(), "rms-ops-console-playwright");

/**
 * Acceptance tests run against a real Supabase stack (local `supabase start` or a hosted project)
 * with the seed applied. Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL. The web server is started here unless BASE_URL is set.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(ART, "report") }]],
  outputDir: path.join(ART, "results"),
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
