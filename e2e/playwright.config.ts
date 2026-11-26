import { defineConfig } from '@playwright/test';

const startPhpServer = Boolean(process.env.START_PHP_SERVER) && !process.env.CI;

const rawBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.APP_BASE_URL ||
  process.env.BASE_URL ||
  (startPhpServer ? 'http://127.0.0.1:8000' : 'http://localhost/LoginSystem');

const baseURL = rawBaseUrl.replace(/\/+$/, '') + '/';

export default defineConfig({
  testDir: './tests',
  globalTeardown: './global-teardown.js',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  ...(startPhpServer
    ? {
        webServer: {
          command: 'php -S 127.0.0.1:8000 -t ..',
          url: 'http://127.0.0.1:8000/LoginSystem/LoginTitle.html',
          reuseExistingServer: true,
          timeout: 30_000,
        },
      }
    : {}),
});