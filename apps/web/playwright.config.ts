import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const port = new URL(baseURL).port || "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? {
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
              },
            }
          : {}),
      },
    },
  ],
  webServer: {
    command: `npm run dev --workspace @eventflow/web -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
