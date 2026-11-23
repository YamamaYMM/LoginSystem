// e2e/tests/login-title-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('LoginTitle.html ログイン・遷移・セッション維持フロー', () => {
  test('登録済みユーザーで LoginTitle.html からログインし、LoginComplete.html へ遷移する', async ({ page }) => {
    const suffix = Date.now().toString().slice(-6);
    const userName = `ログイン検証_${suffix}`;
    const userId = `login_e2e_${suffix}`;
    const password = 'PassWord123';

    // 1. 事前準備として新規アカウントを登録
    await page.goto('/LoginRegister.html');
    await page.locator('#nameInput').fill(userName);
    await page.locator('#roleSelect').selectOption('general');
    await page.locator('#newIdInput').fill(userId);
    await page.locator('#newPassInput').fill(password);
    await page.locator('#confirmPassInput').fill(password);

    const [registerRes] = await Promise.all([
      page.waitForResponse((res) =>
        res.url().includes('auth_api.php') && res.request().method() === 'POST'
      ),
      page.getByRole('button', { name: '登録する' }).click(),
    ]);
    expect(registerRes.status()).toBe(201);

    await page.waitForURL(/LoginComplete\.html/);
    await expect(page.locator('#mainContent')).toBeVisible();

    // 2. 一度ログアウトして未認証状態にする
    const [logoutRes] = await Promise.all([
      page.waitForResponse((res) =>
        res.url().includes('auth_api.php') && res.request().method() === 'POST'
      ),
      page.locator('#logoutButton').click(),
    ]);
    expect(logoutRes.ok()).toBeTruthy();

    // 3. LoginTitle.html を開いてログイン
    // ※ 入力欄の id / placeholder / ボタン名は LoginTitle.html の実際の markup に合わせて調整してください
    await page.goto('/LoginTitle.html');

    // 4. ログイン成功後の LoginComplete.html 遷移とセッション維持を確認
    await page.waitForURL(/LoginComplete\.html/);
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#welcomeMessage')).toContainText(userName);

    await page.reload();
    await expect(page.locator('#mainContent')).toBeVisible();
    await expect(page.locator('#welcomeMessage')).toContainText(userName);
  });
});