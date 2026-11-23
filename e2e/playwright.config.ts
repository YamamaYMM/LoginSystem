import { defineConfig, devices } from '@playwright/test';

declare const process: { env?: Record<string, string | undefined> };

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env?.PLAYWRIGHT_BASE_URL || 'http://localhost/LoginSystem/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});