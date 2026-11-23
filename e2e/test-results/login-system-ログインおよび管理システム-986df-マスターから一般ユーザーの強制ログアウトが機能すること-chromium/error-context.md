# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login-system.spec.js >> ログインおよび管理システムのE2E自動テスト >> 4. サブマスターから一般ユーザーの強制ログアウトが機能すること
- Location: tests\login-system.spec.js:193:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - heading "ログイン" [level=1] [ref=e3]
  - heading "17:24:11" [level=2] [ref=e4]
  - generic [ref=e5]:
    - generic [ref=e6]:
      - paragraph [ref=e7]: お名前 (氏名)
      - textbox "名前を入力" [ref=e8]: サブ管理者
      - paragraph [ref=e9]: ID
      - textbox "8文字以上" [ref=e10]: testsub01
      - paragraph [ref=e11]: パスワード
      - textbox "8文字以上" [ref=e12]: Str0ng!Pass#2026
      - generic [ref=e13]:
        - checkbox "パスワードを表示" [ref=e14]
        - text: パスワードを表示
      - button "決定" [ref=e15] [cursor=pointer]
    - button "ゲストとしてログイン" [ref=e16] [cursor=pointer]
    - generic [ref=e17]:
      - button "新規登録" [ref=e18] [cursor=pointer]
      - button "パスワードをお忘れですか？" [ref=e19] [cursor=pointer]
  - paragraph [ref=e20]: このIDは登録されていません。新規登録を行ってください。
```

# Test source

```ts
  129 |       await page.click('button[type="submit"]');
  130 |       await page.waitForURL(/LoginComplete\.html/, { timeout });
  131 |     } catch (err) {
  132 |       const errText = await page.locator('#errorMessage').textContent().catch(() => '');
  133 |       throw new Error(
  134 |         `Redirect failed. url=${page.url()} errorMessage="${errText}" authApi=${JSON.stringify(apiResult)}`
  135 |       );
  136 |     } finally {
  137 |       page.off('response', onResponse);
  138 |     }
  139 |   }
  140 | 
  141 |   test('1. 未入力や不備のある入力でログインエラーメッセージが表示されること', async ({ page }) => {
  142 |     await page.goto(`${BASE_URL}/LoginTitle.html`);
  143 | 
  144 |     await page.click('button[type="submit"]');
  145 |     await expect(page.locator('#errorMessage')).toHaveText('お名前、ID、パスワードをすべて入力してください');
  146 | 
  147 |     // 8文字未満のIDでエラーになることを確認
  148 |     await page.fill('#nameInput', '一般太郎');
  149 |     await page.fill('#idInput', 'user01'); // 6文字なのでエラーになるべきケース
  150 |     await page.fill('#passInput', 'Password123');
  151 |     await page.click('button[type="submit"]');
  152 |     await expect(page.locator('#errorMessage')).toHaveText('IDは8文字以上入力してください');
  153 |   });
  154 | 
  155 |   test('2. 正しい認証情報(8文字以上)でログインし、メインメニューへ遷移すること', async ({ page }) => {
  156 |     await page.goto(`${BASE_URL}/LoginTitle.html`);
  157 | 
  158 |     await submitLoginAndWaitComplete(page, {
  159 |       name: '一般太郎',
  160 |       id: 'testuser01',
  161 |       password: 'Str0ng!Pass#2026',
  162 |     }, 5000);
  163 |     await expect(page.locator('#welcomeMessage')).toContainText('一般太郎 さん！');
  164 |   });
  165 | 
  166 |   test('3. 同一アカウントの重複ログインがブロックされること', async ({ browser, request }) => {
  167 |     await ensureUsersRegistered(request, INITIAL_USERS);
  168 | 
  169 |     const context = await browser.newContext();
  170 |     const page1 = await context.newPage();
  171 |     const page2 = await context.newPage();
  172 | 
  173 |     // 1つ目のタブでログイン
  174 |     await page1.goto(`${BASE_URL}/LoginTitle.html`);
  175 |     await page1.fill('#nameInput', '一般太郎');
  176 |     await page1.fill('#idInput', 'testuser01');
  177 |     await page1.fill('#passInput', 'Str0ng!Pass#2026');
  178 |     await page1.click('button[type="submit"]');
  179 |     await page1.waitForURL(`${BASE_URL}/LoginComplete.html`);
  180 | 
  181 |     // 2つ目のタブで同じアカウントによるログインを試行
  182 |     await page2.goto(`${BASE_URL}/LoginTitle.html`);
  183 |     await page2.fill('#nameInput', '一般太郎');
  184 |     await page2.fill('#idInput', 'testuser01');
  185 |     await page2.fill('#passInput', 'Str0ng!Pass#2026');
  186 |     await page2.click('button[type="submit"]');
  187 | 
  188 |     await expect(page2.locator('#errorMessage')).toHaveText('このアカウントはすでにログインしています');
  189 | 
  190 |     await context.close();
  191 |   });
  192 | 
  193 |   test('4. サブマスターから一般ユーザーの強制ログアウトが機能すること', async ({ browser, request }) => {
  194 |     await ensureUsersRegistered(request, INITIAL_USERS);
  195 | 
  196 |     const context = await browser.newContext();
  197 |     const subPage = await context.newPage();
  198 |     const userPage = await context.newPage();
  199 | 
  200 |     // サブマスター側のネイティブダイアログ（confirm / alert）を自動承諾
  201 |     subPage.on('dialog', async dialog => {
  202 |       await dialog.accept();
  203 |     });
  204 | 
  205 |     // 一般ユーザーでログイン
  206 |     await userPage.goto(`${BASE_URL}/LoginTitle.html`);
  207 |     await userPage.fill('#nameInput', '一般太郎');
  208 |     await userPage.fill('#idInput', 'testuser01');
  209 |     await userPage.fill('#passInput', 'Str0ng!Pass#2026');
  210 |     await userPage.click('button[type="submit"]');
  211 |     await userPage.waitForURL(/LoginComplete\.html/, { timeout: 10000 });
  212 | 
  213 |     // active_sessions に testuser01 が記録されるのを待つ
  214 |     await userPage.waitForFunction(() => {
  215 |       try {
  216 |         const sessions = JSON.parse(localStorage.getItem('active_sessions')) || [];
  217 |         return sessions.some(s => s.userId === 'testuser01');
  218 |       } catch (e) {
  219 |         return false;
  220 |       }
  221 |     }, { timeout: 10000 });
  222 | 
  223 |     // サブマスターでログイン
  224 |     await subPage.goto(`${BASE_URL}/LoginTitle.html`);
  225 |     await subPage.fill('#nameInput', 'サブ管理者');
  226 |     await subPage.fill('#idInput', 'testsub01');
  227 |     await subPage.fill('#passInput', 'Str0ng!Pass#2026');
  228 |     await subPage.click('button[type="submit"]');
> 229 |     await subPage.waitForURL(/LoginComplete\.html/, { timeout: 10000 });
      |                   ^ TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
  230 | 
  231 |     // 強制ログアウトボタンが有効になるのを待ち、クリック
  232 |     const logoutBtn = subPage.locator('.force-logout-btn[data-id="testuser01"]');
  233 |     await expect(logoutBtn).toBeEnabled({ timeout: 10000 });
  234 |     await logoutBtn.click();
  235 | 
  236 |     // userPage 側のカスタムダイアログの「OK」ボタンをクリック
  237 |     const okBtn = userPage.locator('[role="alertdialog"] button', { hasText: 'OK' });
  238 |     await expect(okBtn).toBeVisible({ timeout: 10000 });
  239 |     await okBtn.click();
  240 | 
  241 |     // 一般ユーザー側が LoginTitle.html に遷移することを確認
  242 |     await expect(userPage).toHaveURL(/LoginTitle\.html/, { timeout: 15000 });
  243 | 
  244 |     await context.close();
  245 |   });
  246 | 
  247 |   test('5. 管理画面のDB接続トグルでON/OFFが切り替わること', async ({ page, request }) => {
  248 |     page.on('dialog', async (dialog) => {
  249 |       console.log('[dialog]', dialog.type(), dialog.message());
  250 |       await dialog.accept().catch(() => {});
  251 |     });
  252 |     page.on('response', (res) => {
  253 |       if (res.request().method() !== 'GET') {
  254 |         console.log('[POST/PUT/PATCH]', res.status(), res.url());
  255 |       }
  256 |     });
  257 | 
  258 |     await ensureUsersRegistered(request, INITIAL_USERS);
  259 |     await resetBrowserStorage(page, { seedDbConfig: true });
  260 | 
  261 |     await submitLoginAndWaitComplete(page, {
  262 |       name: 'マスター管理者',
  263 |       id: 'testmaster01',
  264 |       password: 'Str0ng!Pass#2026',
  265 |     }, 8000);
  266 | 
  267 |     await page.click('#goToManagerBtn');
  268 |     await page.waitForURL(/LoginManager\.html/, { timeout: 8000 });
  269 | 
  270 |     const toggleLabel = page.locator('#dbToggleLabel').first();
  271 |     const toggleSlider = page.locator('label[for="dbConnectionToggle"]').first();
  272 |     const toggleCheckbox = page.locator('#dbConnectionToggle');
  273 | 
  274 |     await expect(toggleLabel).toBeVisible();
  275 | 
  276 |     // 初期状態が OFF の場合は ON に切り替え
  277 |     if ((await toggleLabel.textContent())?.trim() === 'OFF') {
  278 |       await toggleSlider.click();
  279 |     }
  280 |     await expect(toggleLabel).toHaveText('ON', { timeout: 10000 });
  281 |     if (await toggleCheckbox.count()) {
  282 |       await expect(toggleCheckbox).toBeChecked();
  283 |     }
  284 | 
  285 |     // OFF に切り替え
  286 |     await toggleSlider.click();
  287 |     await expect(toggleLabel).toHaveText('OFF', { timeout: 10000 });
  288 |     await expect(page.locator('#dbStatusMessage')).toContainText('OFF');
  289 | 
  290 |     // ON に戻す
  291 |     await toggleSlider.click();
  292 |     await expect(toggleLabel).toHaveText('ON', { timeout: 10000 });
  293 |   });
  294 | 
  295 |   test.afterAll(async () => {
  296 |     await cleanupTestUsers();
  297 |   });
  298 | });
```