import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001",
      NEXT_PUBLIC_ADAPTIVE_THEME_ENABLED: "true",
      NEXT_PUBLIC_SAFETY_NUMBERS_ENABLED: "true",
      NEXT_PUBLIC_DAILY_BRIEF_ENABLED: "true",
    },
  },
  projects: [
    {
      name: "iphone",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "pixel",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
      },
    },
  ],
});
