// e2e/tests/login-title-flow.spec.ts
import { test, expect } from '@playwright/test';

const rawBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.APP_BASE_URL ||
  'http://localhost/LoginSystem';
const BASE_URL = rawBaseUrl.replace(/\/+$/, '');

async function cleanupUserBySelf(
  request: any,
  user: { name: string; id: string; password: string } | null
) {
  if (!user) return;
  try {
    const statusRes = await request.post(`${BASE_URL}/auth_api.php`, {
      data: { action: 'session_status' },
    });
    const statusBody = await statusRes.json().catch(() => ({}));
    const initToken = statusBody.csrfToken || '';
    if (!initToken) return;

    const loginRes = await request.post(`${BASE_URL}/auth_api.php`, {
      headers: { 'X-CSRF-Token': initToken },
      data: {
        action: 'login_session',
        csrfToken: initToken,
        name: user.name,
        id: user.id,
        password: user.password,
      },
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok() || loginBody.status !== 'success') return;

    const activeToken = loginBody.csrfToken || initToken;
    await request.post(`${BASE_URL}/auth_api.php`, {
      headers: { 'X-CSRF-Token': activeToken },
      data: { action: 'delete_self', csrfToken: activeToken },
    });
  } catch {
    // クリーンアップ失敗でテスト終了を妨げない
  }
}

test.describe('LoginTitle.html ログイン・遷移・セッション維持フロー', () => {
  let createdUser: { name: string; id: string; password: string } | null = null;

  test.afterEach(async ({ request }) => {
    await cleanupUserBySelf(request, createdUser);
    createdUser = null;
  });

  test('新規登録したユーザーでログインし、LoginComplete.html 遷移・リロード維持・ログアウトができる', async ({
    page,
  }) => {
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    const suffix = `${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    const userName = `ログイン検証_${suffix}`;
    const userId = `login_e2e_${suffix}`;
    const password = 'Str0ng!Pass#2026';
    createdUser = { name: userName, id: userId, password };

    // 1. 新規アカウント登録
    await page.goto(`${BASE_URL}/LoginRegister.html`);
    await page.locator('#nameInput').fill(userName);
    await page.locator('#roleSelect').selectOption('general');
    await page.locator('#newIdInput').fill(userId);
    await page.locator('#newPassInput').fill(password);
    await page.locator('#confirmPassInput').fill(password);

    const [registerRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('auth_api.php') && res.request().method() === 'POST'
      ),
      page.getByRole('button', { name: '登録する' }).click(),
    ]);
    expect([200, 201]).toContain(registerRes.status());

    // 登録後の画面更新や遅延リダイレクトが走る余地を吸収する
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(300);
    if (!page.url().includes('LoginTitle.html')) {
      await page.goto(`${BASE_URL}/LoginTitle.html`, { waitUntil: 'load' });
    }

    // 2. LoginTitle.html からログインして LoginComplete.html へ遷移
    await page.locator('#nameInput').fill(userName);
    await page.locator('#idInput').fill(userId);
    await page.locator('#passInput').fill(password);

    await Promise.all([
      page.waitForURL(/LoginComplete\.html/),
      page.locator('button[type="submit"]').click(),
    ]);
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#welcomeMessage')).toContainText(userName);

    // 3. リロード後もセッションが維持されることを確認
    await page.reload();
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#welcomeMessage')).toContainText(userName);

    // 4. ログアウトして未認証状態に戻す
    const [logoutRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('auth_api.php') && res.request().method() === 'POST'
      ),
      page.locator('#logoutButton').click(),
    ]);
    expect(logoutRes.ok()).toBeTruthy();
  });
});