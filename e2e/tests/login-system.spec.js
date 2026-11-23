// tests/login-system.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.APP_BASE_URL || 'http://loginsystem.test';

// 8文字以上のテスト用アカウント定義
const INITIAL_USERS = [
  { id: 'testmaster01', name: 'マスター管理者', password: 'Str0ng!Pass#2026', role: 'master' },
  { id: 'testsub01', name: 'サブ管理者', password: 'Str0ng!Pass#2026', role: 'submaster' },
  { id: 'testuser01', name: '一般太郎', password: 'Str0ng!Pass#2026', role: 'general' },
];

async function resetBrowserStorage(page, { seedDbConfig = false } = {}) {
  await page.goto(`${BASE_URL}/LoginTitle.html`);
  await page.evaluate((shouldSeed) => {
    localStorage.clear();
    sessionStorage.clear();
    if (shouldSeed) {
      localStorage.setItem('dbConfig', JSON.stringify({ enabled: true }));
    }
  }, seedDbConfig);
}

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
    if (user.role && user.role !== 'general') {
      continue;
    }

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
        role: 'general',
      },
    });

    const statusCode = res.status();
    const body = await res.json().catch(() => ({}));

    if (statusCode === 409 && body.status !== 'success') {
      continue;
    }

    if (!res.ok() || body.status !== 'success') {
      throw new Error(
        `Failed to seed user ${user.id} (${statusCode}): ${body.message || 'unknown error'}`
      );
    }
  }
}

async function cleanupTestUsers() {
  // auth_api.php に cleanup_test_users アクションは存在しないためスキップ
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

test.describe('ログインおよび管理システムのE2E自動テスト', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureUsersRegistered(request, INITIAL_USERS);

    await page.context().clearCookies();
    await page.goto(`${BASE_URL}/LoginTitle.html`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  async function loginAndAssertRedirect(page, { name, id, password }, timeout = 8000) {
    let apiResult = null;
    const onResponse = async res => {
      if (res.url().includes('auth_api.php')) {
        apiResult = { status: res.status(), body: await res.json().catch(() => null) };
      }
    };
    page.on('response', onResponse);

    try {
      await page.fill('#nameInput', name);
      await page.fill('#idInput', id);
      await page.fill('#passInput', password);
      await page.click('button[type="submit"]');
      await page.waitForURL(/LoginComplete\.html/, { timeout });
    } catch (err) {
      const errText = await page.locator('#errorMessage').textContent().catch(() => '');
      throw new Error(
        `Redirect failed. url=${page.url()} errorMessage="${errText}" authApi=${JSON.stringify(apiResult)}`
      );
    } finally {
      page.off('response', onResponse);
    }
  }

  test('1. 未入力や不備のある入力でログインエラーメッセージが表示されること', async ({ page }) => {
    await page.goto(`${BASE_URL}/LoginTitle.html`);

    await page.click('button[type="submit"]');
    await expect(page.locator('#errorMessage')).toHaveText('お名前、ID、パスワードをすべて入力してください');

    // 8文字未満のIDでエラーになることを確認
    await page.fill('#nameInput', '一般太郎');
    await page.fill('#idInput', 'user01'); // 6文字なのでエラーになるべきケース
    await page.fill('#passInput', 'Password123');
    await page.click('button[type="submit"]');
    await expect(page.locator('#errorMessage')).toHaveText('IDは8文字以上入力してください');
  });

  test('2. 正しい認証情報(8文字以上)でログインし、メインメニューへ遷移すること', async ({ page }) => {
    await page.goto(`${BASE_URL}/LoginTitle.html`);

    await submitLoginAndWaitComplete(page, {
      name: '一般太郎',
      id: 'testuser01',
      password: 'Str0ng!Pass#2026',
    }, 5000);
    await expect(page.locator('#welcomeMessage')).toContainText('一般太郎 さん！');
  });

  test('3. 同一アカウントの重複ログインがブロックされること', async ({ browser, request }) => {
    await ensureUsersRegistered(request, INITIAL_USERS);

    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    // 1つ目のタブでログイン
    await page1.goto(`${BASE_URL}/LoginTitle.html`);
    await page1.fill('#nameInput', '一般太郎');
    await page1.fill('#idInput', 'testuser01');
    await page1.fill('#passInput', 'Str0ng!Pass#2026');
    await page1.click('button[type="submit"]');
    await page1.waitForURL(`${BASE_URL}/LoginComplete.html`);

    // 2つ目のタブで同じアカウントによるログインを試行
    await page2.goto(`${BASE_URL}/LoginTitle.html`);
    await page2.fill('#nameInput', '一般太郎');
    await page2.fill('#idInput', 'testuser01');
    await page2.fill('#passInput', 'Str0ng!Pass#2026');
    await page2.click('button[type="submit"]');

    await expect(page2.locator('#errorMessage')).toHaveText('このアカウントはすでにログインしています');

    await context.close();
  });

  test('4. サブマスターから一般ユーザーの強制ログアウトが機能すること', async ({ browser, request }) => {
    await ensureUsersRegistered(request, INITIAL_USERS);

    const context = await browser.newContext();
    const subPage = await context.newPage();
    const userPage = await context.newPage();

    // サブマスター側のネイティブダイアログ（confirm / alert）を自動承諾
    subPage.on('dialog', async dialog => {
      await dialog.accept();
    });

    // 一般ユーザーでログイン
    await userPage.goto(`${BASE_URL}/LoginTitle.html`);
    await userPage.fill('#nameInput', '一般太郎');
    await userPage.fill('#idInput', 'testuser01');
    await userPage.fill('#passInput', 'Str0ng!Pass#2026');
    await userPage.click('button[type="submit"]');
    await userPage.waitForURL(/LoginComplete\.html/, { timeout: 10000 });

    // active_sessions に testuser01 が記録されるのを待つ
    await userPage.waitForFunction(() => {
      try {
        const sessions = JSON.parse(localStorage.getItem('active_sessions')) || [];
        return sessions.some(s => s.userId === 'testuser01');
      } catch (e) {
        return false;
      }
    }, { timeout: 10000 });

    // サブマスターでログイン
    await subPage.goto(`${BASE_URL}/LoginTitle.html`);
    await subPage.fill('#nameInput', 'サブ管理者');
    await subPage.fill('#idInput', 'testsub01');
    await subPage.fill('#passInput', 'Str0ng!Pass#2026');
    await subPage.click('button[type="submit"]');
    await subPage.waitForURL(/LoginComplete\.html/, { timeout: 10000 });

    // 強制ログアウトボタンが有効になるのを待ち、クリック
    const logoutBtn = subPage.locator('.force-logout-btn[data-id="testuser01"]');
    await expect(logoutBtn).toBeEnabled({ timeout: 10000 });
    await logoutBtn.click();

    // userPage 側のカスタムダイアログの「OK」ボタンをクリック
    const okBtn = userPage.locator('[role="alertdialog"] button', { hasText: 'OK' });
    await expect(okBtn).toBeVisible({ timeout: 10000 });
    await okBtn.click();

    // 一般ユーザー側が LoginTitle.html に遷移することを確認
    await expect(userPage).toHaveURL(/LoginTitle\.html/, { timeout: 15000 });

    await context.close();
  });

  test('5. 管理画面のDB接続トグルでON/OFFが切り替わること', async ({ page, request }) => {
    page.on('dialog', async (dialog) => {
      console.log('[dialog]', dialog.type(), dialog.message());
      await dialog.accept().catch(() => {});
    });
    page.on('response', (res) => {
      if (res.request().method() !== 'GET') {
        console.log('[POST/PUT/PATCH]', res.status(), res.url());
      }
    });

    await ensureUsersRegistered(request, INITIAL_USERS);
    await resetBrowserStorage(page, { seedDbConfig: true });

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

    // 初期状態が OFF の場合は ON に切り替え
    if ((await toggleLabel.textContent())?.trim() === 'OFF') {
      await toggleSlider.click();
    }
    await expect(toggleLabel).toHaveText('ON', { timeout: 10000 });
    if (await toggleCheckbox.count()) {
      await expect(toggleCheckbox).toBeChecked();
    }

    // OFF に切り替え
    await toggleSlider.click();
    await expect(toggleLabel).toHaveText('OFF', { timeout: 10000 });
    await expect(page.locator('#dbStatusMessage')).toContainText('OFF');

    // ON に戻す
    await toggleSlider.click();
    await expect(toggleLabel).toHaveText('ON', { timeout: 10000 });
  });

  test.afterAll(async () => {
    await cleanupTestUsers();
  });
});