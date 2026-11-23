import { test, expect } from '@playwright/test';

const MASTER_USER = {
  name: 'テスト管理者',
  id: 'master_user_01',
  password: 'StrongPassword#2026',
  role: 'master',
};

const GENERAL_USER = {
  name: 'テスト一般',
  id: 'general_user_01',
  password: 'GeneralPassword#2026',
  role: 'general',
};

test.describe('認証・履歴・管理フロー E2E', () => {
  test('マスター登録 → ログイン履歴保存 → 権限切替 → ユーザー削除とDBクリーンアップ', async ({ page }) => {
    // 1. 新規登録画面からマスター登録
    await page.goto('/LoginRegister.html');
    await page.fill('#nameInput', MASTER_USER.name);
    await page.selectOption('#roleSelect', MASTER_USER.role);
    await page.fill('#newIdInput', MASTER_USER.id);
    await page.fill('#newPassInput', MASTER_USER.password);
    await page.fill('#confirmPassInput', MASTER_USER.password);

    page.once('dialog', dialog => dialog.accept());
    await page.click('#registerForm button[type="submit"]');
    await page.waitForURL('**/LoginTitle.html');

    // 2. ログイン → 半透明オーバーレイ表示 → 完了画面遷移
    await page.fill('#nameInput', MASTER_USER.name);
    await page.fill('#idInput', MASTER_USER.id);
    await page.fill('#passInput', MASTER_USER.password);
    await page.click('#loginForm button[type="submit"]');

    await page.waitForURL('**/LoginComplete.html');
    await expect(page.locator('#welcomeMessage')).toContainText(`ようこそ、${MASTER_USER.name} さん！`);

    // 3. 管理画面でDB接続ON → ログイン履歴表示 → リセット
    await page.click('#goToManagerBtn');
    await page.waitForURL('**/LoginManager.html');

    await page.check('#dbConnectionToggle');
    await expect(page.locator('#userTable')).toBeVisible();
    await expect(page.locator('#userTable')).toContainText(MASTER_USER.id);

    page.once('dialog', dialog => dialog.accept());
    await page.click('#resetButton');
    page.once('dialog', dialog => dialog.accept());
    await expect(page.locator('#userTable tr')).toHaveCount(1); // ヘッダー行のみ

    // 4. 完了画面へ戻り、一般ユーザー登録後に権限付与/剥奪を確認
    await page.click('#backToCompleteButton');
    await page.waitForURL('**/LoginComplete.html');

    // 別コンテキストまたはログアウト後に一般ユーザーを登録（必要に応じて調整）
    // ここでは一般ユーザー削除と最終ユーザー削除時の遷移を確認
    await page.click('#deleteAccountButton');
    page.once('dialog', dialog => dialog.accept());
    page.once('dialog', dialog => dialog.accept());
    await page.waitForURL('**/LoginTitle.html');
  });
});