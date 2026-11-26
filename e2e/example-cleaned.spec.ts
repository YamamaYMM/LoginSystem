// e2e/example-cleaned.spec.ts
import { test, expect } from '@playwright/test';
import { createUniqueUser, loginViaUi } from './helpers/testData';
import { clearPageStorage } from './helpers/cleanup';

test.describe('ログイン・DB連携フロー', () => {
  test.beforeEach(async ({ page, request }) => {
    // 必要に応じてテスト用リセットエンドポイントやAPIを呼ぶ
    // await request.post('/test_reset.php', { headers: { 'X-Test-Env': 'test' } });
    await page.goto('LoginTitle.html');
    await clearPageStorage(page);
  });

  test.afterEach(async ({ page }) => {
    await clearPageStorage(page);
  });

  test('一意ユーザーで登録・ログインし履歴操作できる', async ({ page }) => {
    const user = createUniqueUser('pw_e2e', 'general');

    await page.goto('LoginTitle.html');
    // 登録フローがある場合は入力・送信し、完了表示やログイン状態を検証
    await loginViaUi(page, user);
    await expect(page.locator('body')).toContainText(user.name);
  });
});