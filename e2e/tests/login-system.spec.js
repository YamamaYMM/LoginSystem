// tests/login-system.spec.js
const { test, expect } = require('@playwright/test');
const { clearPageStorage, createRunTracker } = require('../helpers/cleanup');

const ALLOWED_LOGIN_TIME = new Date('2026-11-24T12:00:00+09:00');
const rawBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.APP_BASE_URL ||
  'http://localhost/LoginSystem';
const BASE_URL = rawBaseUrl.replace(/\/+$/, '');

// 8文字以上のテスト用アカウント定義
const INITIAL_USERS = [
  { id: 'testmaster01', name: 'マスター管理者', password: 'Str0ng!Pass#2026', role: 'master' },
  { id: 'testsub01', name: 'サブ管理者', password: 'Str0ng!Pass#2026', role: 'submaster' },
  { id: 'testuser01', name: '一般太郎', password: 'Str0ng!Pass#2026', role: 'general' },
];

async function getCsrfToken(request) {
  const res = await request.post(`${BASE_URL}/auth_api.php`, {
    data: { action: 'session_status' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || !body.csrfToken) {
    throw new Error(`Failed to fetch CSRF token (${res.status()}): ${body.message || 'unknown error'}`);
  }
  return body.csrfToken;
}

async function ensureUsersRegistered(request, users) {
  const csrfToken = await getCsrfToken(request);

  for (const user of users) {
    const role = user.role || 'general';

    const res = await request.post(`${BASE_URL}/auth_api.php`, {
      headers: {
        'X-CSRF-Token': csrfToken,
      },
      data: {
        action: 'register_user',
        csrfToken,
        name: user.name,
        id: user.id,
        password: user.password,
        role,
      },
    });

    const statusCode = res.status();
    const body = await res.json().catch(() => ({}));

    if (res.ok() || body.status === 'success' || statusCode === 409) {
      continue;
    }

    throw new Error(
      `Failed to seed user ${user.id} (${statusCode}): ${body.message || 'unknown error'}`
    );
  }
}

async function loginAsAdminAndGetCsrf(request, adminUser) {
  const initToken = await getCsrfToken(request);

  const loginRes = await request.post(`${BASE_URL}/auth_api.php`, {
    headers: { 'X-CSRF-Token': initToken },
    data: {
      action: 'login_session',
      csrfToken: initToken,
      name: adminUser.name,
      id: adminUser.id,
      password: adminUser.password,
    },
  });

  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok() || loginBody.status !== 'success') {
    throw new Error(
      `Failed to login as admin (${loginRes.status()}): ${loginBody.message || 'unknown error'}`
    );
  }

  return loginBody.csrfToken || initToken;
}

async function deleteUserById(request, csrfToken, targetId) {
  const res = await request.post(`${BASE_URL}/auth_api.php`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      action: 'delete_user',
      csrfToken,
      targetId,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || body.status !== 'success') {
    console.warn(
      `[cleanupTestUsers] delete_user(${targetId}) skipped/failed (${res.status()}): ${body.message || ''}`
    );
  }
}

async function deleteCurrentSessionUser(request, csrfToken) {
  const res = await request.post(`${BASE_URL}/auth_api.php`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { action: 'delete_self', csrfToken },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok() || body.status !== 'success') {
    console.warn(
      `[cleanupTestUsers] delete_self failed (${res.status()}): ${body.message || ''}`
    );
  }
}

async function cleanupTestUsers(request, extraUserIds = [], { deleteAdminSelf = true } = {}) {
  const adminUser = INITIAL_USERS.find(user => user.role === 'master');
  if (!adminUser) return;

  try {
    const activeCsrfToken = await loginAsAdminAndGetCsrf(request, adminUser);
    const managedTargetIds = Array.from(new Set([
      ...extraUserIds,
      ...INITIAL_USERS.filter(user => user.id !== adminUser.id).map(user => user.id),
    ])).filter(id => Boolean(id) && id !== adminUser.id);

    for (const targetId of managedTargetIds) {
      await deleteUserById(request, activeCsrfToken, targetId);
    }

    if (deleteAdminSelf) {
      await deleteCurrentSessionUser(request, activeCsrfToken);
    }
  } catch (err) {
    console.warn('[cleanupTestUsers] クリーンアップ中にエラー:', err);
  }
}

async function submitLoginAndWaitComplete(page, { name, id, password }, timeout = 8000) {
  let lastAuthResponse = null;

  const onResponse = async res => {
    if (res.url().includes('auth_api.php')) {
      const json = await res.json().catch(() => null);
      lastAuthResponse = { status: res.status(), body: json };
    }
  };

  page.on('response', onResponse);
  try {
    await page.fill('#nameInput', name);
    await page.fill('#idInput', id);
    await page.fill('#passInput', password);
    await page.click('button[type="submit"]');

    await page.waitForURL(`${BASE_URL}/LoginComplete.html`, { timeout });
  } catch (err) {
    const errorMessage = await page.locator('#errorMessage').textContent().catch(() => '');
    throw new Error(
      `LoginComplete.html へ遷移できませんでした (url=${page.url()}, errorMessage="${errorMessage}", authApi=${JSON.stringify(lastAuthResponse)})`
    );
  } finally {
    page.off('response', onResponse);
  }
}

test.describe('ログインおよび管理システムのE2E自動テスト（UI競合・管理操作）', () => {
  const runTracker = createRunTracker();

  test.beforeEach(async ({ page, request }) => {
    await page.clock.install({ time: ALLOWED_LOGIN_TIME });
    await ensureUsersRegistered(request, INITIAL_USERS);

    await page.context().clearCookies();
    await page.goto(`${BASE_URL}/LoginTitle.html`);
    await clearPageStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearPageStorage(page);
  });

  test.afterAll(async ({ request }) => {
    await cleanupTestUsers(request, runTracker.getTrackedUserIds(), {
      deleteAdminSelf: true,
    });
  });

  test('1. 同一アカウントの重複ログインがブロックされること', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    await page1.clock.install({ time: ALLOWED_LOGIN_TIME });
    await page2.clock.install({ time: ALLOWED_LOGIN_TIME });

    await page1.goto(`${BASE_URL}/LoginTitle.html`);
    await page1.fill('#nameInput', '一般太郎');
    await page1.fill('#idInput', 'testuser01');
    await page1.fill('#passInput', 'Str0ng!Pass#2026');
    await page1.click('button[type="submit"]');
    await page1.waitForURL(`${BASE_URL}/LoginComplete.html`);

    await page2.goto(`${BASE_URL}/LoginTitle.html`);
    await page2.fill('#nameInput', '一般太郎');
    await page2.fill('#idInput', 'testuser01');
    await page2.fill('#passInput', 'Str0ng!Pass#2026');
    await page2.click('button[type="submit"]');

    await expect(page2.locator('#errorMessage')).toHaveText('このアカウントはすでにログインしています');

    await context.close();
  });

  test('2. サブマスターから一般ユーザーの強制ログアウトが機能すること', async ({ browser }) => {
    const context = await browser.newContext();
    const subPage = await context.newPage();
    const userPage = await context.newPage();
    await subPage.clock.install({ time: ALLOWED_LOGIN_TIME });
    await userPage.clock.install({ time: ALLOWED_LOGIN_TIME });

    subPage.on('dialog', async dialog => {
      await dialog.accept();
    });

    await userPage.goto(`${BASE_URL}/LoginTitle.html`);
    await userPage.fill('#nameInput', '一般太郎');
    await userPage.fill('#idInput', 'testuser01');
    await userPage.fill('#passInput', 'Str0ng!Pass#2026');
    await userPage.click('button[type="submit"]');
    await userPage.waitForURL(/LoginComplete\.html/, { timeout: 10000 });

    await userPage.waitForFunction(() => {
      try {
        const sessions = JSON.parse(localStorage.getItem('active_sessions')) || [];
        return sessions.some(s => s.userId === 'testuser01');
      } catch (e) {
        return false;
      }
    }, { timeout: 10000 });

    await subPage.goto(`${BASE_URL}/LoginTitle.html`);
    await subPage.fill('#nameInput', 'サブ管理者');
    await subPage.fill('#idInput', 'testsub01');
    await subPage.fill('#passInput', 'Str0ng!Pass#2026');
    await subPage.click('button[type="submit"]');
    await subPage.waitForURL(/LoginComplete\.html/, { timeout: 10000 });

    const logoutBtn = subPage.locator('.force-logout-btn[data-id="testuser01"]');
    await expect(logoutBtn).toBeEnabled({ timeout: 10000 });
    await logoutBtn.click();

    const okBtn = userPage.locator('[role="alertdialog"] button', { hasText: 'OK' });
    await expect(okBtn).toBeVisible({ timeout: 10000 });
    await okBtn.click();

    await expect(userPage).toHaveURL(/LoginTitle\.html/, { timeout: 15000 });

    await context.close();
  });

  test('3. 管理画面のDB接続トグルでON/OFFが切り替わること', async ({ page }) => {
    page.on('dialog', async dialog => {
      await dialog.accept().catch(() => {});
    });

    await page.evaluate(() => {
      localStorage.setItem('dbConfig', JSON.stringify({ enabled: true }));
    });

    await submitLoginAndWaitComplete(page, {
      name: 'マスター管理者',
      id: 'testmaster01',
      password: 'Str0ng!Pass#2026',
    }, 8000);

    await page.click('#goToManagerBtn');
    await page.waitForURL(/LoginManager\.html/, { timeout: 8000 });

    const toggleLabel = page.locator('#dbToggleLabel').first();
    const toggleSlider = page.locator('label[for="dbConnectionToggle"]').first();
    const toggleCheckbox = page.locator('#dbConnectionToggle');

    await expect(toggleLabel).toBeVisible();

    if ((await toggleLabel.textContent())?.trim() === 'OFF') {
      await Promise.all([
        page.waitForResponse(
          res => res.request().method() === 'POST' && /Database\.php|api\.php/i.test(res.url())
        ).catch(() => null),
        toggleSlider.click(),
      ]);
    }
    await expect(toggleLabel).toHaveText('ON', { timeout: 10000 });
    if (await toggleCheckbox.count()) {
      await expect(toggleCheckbox).toBeChecked();
    }

    await toggleSlider.click();
    await expect(toggleLabel).toHaveText('OFF', { timeout: 10000 });
    await expect(page.locator('#dbStatusMessage')).toContainText('OFF');

    await toggleSlider.click();
    await expect(toggleLabel).toHaveText('ON', { timeout: 10000 });
  });
});