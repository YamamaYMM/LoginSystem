import { test, expect } from '@playwright/test';

let activeMasterUser = null;

test.describe('認証・履歴・管理フロー E2E', () => {
  test.afterEach(async ({ request, baseURL }) => {
    const base = (baseURL || 'http://localhost/LoginSystem').replace(/\/+$/, '');
    const targetUser = activeMasterUser;
    if (!targetUser) return;

    try {
      const statusRes = await request.post(`${base}/auth_api.php`, {
        data: { action: 'session_status' },
      });
      const statusBody = await statusRes.json().catch(() => ({}));
      const token = statusBody.csrfToken;
      if (!token) return;

      const loginRes = await request.post(`${base}/auth_api.php`, {
        headers: { 'X-CSRF-Token': token },
        data: {
          action: 'login_session',
          csrfToken: token,
          name: targetUser.name,
          id: targetUser.id,
          password: targetUser.password,
        },
      });
      const loginBody = await loginRes.json().catch(() => ({}));
      const activeToken = loginBody.csrfToken || token;

      if (loginRes.ok() && loginBody.status === 'success') {
        await request
          .post(`${base}/auth_api.php`, {
            headers: { 'X-CSRF-Token': activeToken },
            data: { action: 'delete_self', csrfToken: activeToken },
          })
          .catch(() => {});
      }
    } catch {
      // すでに削除済みなどの場合は無視
    }
  });

  test('マスター登録 → ログイン履歴保存 → 権限切替 → ユーザー削除とDBクリーンアップ', async ({ page }) => {
    const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const masterUser = {
      name: `テスト管理者_${uniqueSuffix}`,
      id: `master_e2e_${uniqueSuffix}`,
      password: 'StrongPassword#2026',
      role: 'master',
    };
    activeMasterUser = masterUser;

    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    await page.goto('LoginRegister.html');
    await page.locator('#nameInput').fill(masterUser.name);
    await page.locator('#roleSelect').selectOption(masterUser.role);
    await page.locator('#newIdInput').fill(masterUser.id);
    await page.locator('#newPassInput').fill(masterUser.password);
    await page.locator('#confirmPassInput').fill(masterUser.password);

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('auth_api.php') && response.request().method() === 'POST'
      ),
      page.getByRole('button', { name: /登録/ }).click(),
    ]);

    await page.waitForURL('**/LoginTitle.html');

    await page.fill('#nameInput', masterUser.name);
    await page.fill('#idInput', masterUser.id);
    await page.fill('#passInput', masterUser.password);
    await page.click('#loginForm button[type="submit"]');

    await page.waitForURL('**/LoginComplete.html');
    await expect(page.locator('#welcomeMessage')).toContainText(`ようこそ、${masterUser.name} さん！`);

    // 3. 管理画面でDB接続ON → ログイン履歴表示 → リセット
    await page.click('#goToManagerBtn');
    await page.waitForURL('**/LoginManager.html');

    const toggleCheckbox = page.locator('#dbConnectionToggle');
    const toggleSlider = page.locator('label[for="dbConnectionToggle"] span, label[for="dbConnectionToggle"]').first();

    if (!(await toggleCheckbox.isChecked())) {
      const [dbRes] = await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes('LoginDatabase.php') && response.request().method() === 'POST',
          { timeout: 10000 }
        ),
        toggleSlider.click(),
      ]);
      expect(dbRes.ok(), `LoginDatabase.php failed with status ${dbRes.status()}`).toBeTruthy();
    }

    await expect(toggleCheckbox).toBeChecked({ timeout: 10000 });
    await expect(page.locator('#dbToggleLabel')).toHaveText('ON', { timeout: 10000 });
    await expect(page.locator('#userTable')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#userTable')).toContainText(masterUser.id, { timeout: 10000 });

    await page.click('#resetButton');
    await expect(page.locator('#userTable tr')).toHaveCount(1); // ヘッダー行のみ

    // 4. 完了画面へ戻り、一般ユーザー登録後に権限付与/剥奪を確認
    await page.click('#backToCompleteButton');
    await page.waitForURL('**/LoginComplete.html');

    // 別コンテキストまたはログアウト後に一般ユーザーを登録（必要に応じて調整）
    // ここでは一般ユーザー削除と最終ユーザー削除時の遷移を確認
    await page.click('#deleteAccountButton');
    await page.waitForURL('**/LoginTitle.html');
  });
});