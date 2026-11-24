// e2e/tests/register-and-session.spec.ts
import { test, expect } from '@playwright/test';

test.describe('新規登録・セッション維持・パスワード変更・ログアウト', () => {
  test('新規登録後にメインメニューへ遷移し、パスワード変更とログアウトができる', async ({ page }) => {
    const uniqueSuffix = Date.now().toString().slice(-6);
    const userName = `E2Eユーザー_${uniqueSuffix}`;
    const userId = `e2e_user_${uniqueSuffix}`;
    const initPass = 'Str0ng!Pass#2026';
    const nextPass = 'N3w!Str0ng#Pass#2026';

    // alert / confirm が出る場合に備えて遷移前から自動承諾
    page.on('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    // ログイン可能時間帯（昼12:00）に時刻を固定
    await page.clock.install({ time: new Date('2026-11-24T12:00:00+09:00') });

    // 1. 新規登録画面を開く
    await page.goto('LoginRegister.html');
    await page.locator('#nameInput').fill(userName);
    await page.locator('#roleSelect').selectOption('general');
    await page.locator('#newIdInput').fill(userId);
    await page.locator('#newPassInput').fill(initPass);
    await page.locator('#confirmPassInput').fill(initPass);

    const [registerRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('auth_api.php') && res.request().method() === 'POST'
      ),
      page.getByRole('button', { name: '登録する' }).click(),
    ]);
    expect([200, 201]).toContain(registerRes.status());

    // 2. ログイン画面へ遷移してログイン
    await page.waitForURL(/LoginTitle\.html/);

    const [loginRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('auth_api.php') && res.request().method() === 'POST'
      ),
      (async () => {
        await page.locator('#nameInput').fill(userName);
        await page.locator('#idInput').fill(userId);
        await page.locator('#passInput').fill(initPass);
        await page.locator('button[type="submit"]').click();
      })(),
    ]);
    expect(loginRes.ok()).toBeTruthy();

    await page.waitForURL(/LoginComplete\.html/);

    // iframe 内かトップページかどちらにメインメニューがあるか待機して特定
    const iframe = page.locator('iframe').first();
    const hasIframe = (await iframe.count()) > 0;
    const container = hasIframe ? page.frameLocator('iframe').first() : page;

    await expect(container.locator('#mainContent')).toBeVisible();
    await expect(container.locator('#welcomeMessage')).toContainText(userName);

    // リロード後のセッション維持確認
    await page.reload();
    const reloadContainer = (await page.locator('iframe').count()) > 0
      ? page.frameLocator('iframe').first()
      : page;
    await expect(reloadContainer.locator('#mainContent')).toBeVisible();
    await expect(reloadContainer.locator('#welcomeMessage')).toContainText(userName);

    // 3. パスワード変更モーダル操作
    await reloadContainer.getByRole('button', { name: /パスワードを変更/ }).click();
    await reloadContainer.locator('#currentPassInput').fill(initPass);
    await reloadContainer.locator('#newPassInput').fill(nextPass);
    await reloadContainer.locator('#confirmNewPassInput').fill(nextPass);

    const [changePassRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('auth_api.php') && res.request().method() === 'POST',
        { timeout: 10000 }
      ),
      reloadContainer.getByRole('button', { name: '変更する' }).click(),
    ]);
    expect(changePassRes.ok()).toBeTruthy();

    // モーダルが閉じてポインター遮断が解除されるのを待つ
    await expect(reloadContainer.locator('#passwordModal')).toBeHidden({ timeout: 10000 });

    // 4. ログアウトしてログイン画面へ遷移することを確認
    await reloadContainer.getByRole('button', { name: 'ログアウト' }).click();

    await expect
      .poll(
        () => [page.url(), ...page.frames().map((f) => f.url())],
        { timeout: 10000 }
      )
      .toEqual(expect.arrayContaining([expect.stringMatching(/LoginTitle\.html/i)]));
  });
});