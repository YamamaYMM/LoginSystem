import { defineConfig } from '@playwright/test';

const rawBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.APP_BASE_URL ||
  process.env.BASE_URL ||
  'http://localhost/LoginSystem';

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
  // 必要に応じてローカル／CIで自動起動したい場合のみ有効化
  // webServer: {
  //   command: 'php -S 127.0.0.1:8000 -t ..',
  //   url: 'http://127.0.0.1:8000',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 30_000,
  // },
});