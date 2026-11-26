import { defineConfig } from '@playwright/test';

const useLocalWebServer = Boolean(process.env.CI || process.env.START_PHP_SERVER);

const rawBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.APP_BASE_URL ||
  process.env.BASE_URL ||
  (useLocalWebServer ? 'http://127.0.0.1:8000/LoginSystem' : 'http://localhost/LoginSystem');

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
  ...(useLocalWebServer
    ? {
        webServer: {
          command: 'php -S 127.0.0.1:8000 -t ..',
          url: 'http://127.0.0.1:8000/LoginSystem/LoginTitle.html',
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }
    : {}),
});