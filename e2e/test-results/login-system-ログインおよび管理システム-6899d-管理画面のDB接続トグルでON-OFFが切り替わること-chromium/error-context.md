# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login-system.spec.js >> ログインおよび管理システムのE2E自動テスト >> 5. 管理画面のDB接続トグルでON/OFFが切り替わること
- Location: tests\login-system.spec.js:247:3

# Error details

```
Error: LoginComplete.html へ遷移できませんでした (url=http://loginsystem.test/LoginTitle.html, errorMessage="このIDは登録されていません。新規登録を行ってください。", authApi={"status":401,"body":{"status":"error","message":"このIDは登録されていません。新規登録を行ってください。"}})
```

# Test source

```ts
  1   | // tests/login-system.spec.js
  2   | const { test, expect } = require('@playwright/test');
  3   | 
  4   | const BASE_URL = process.env.APP_BASE_URL || 'http://loginsystem.test';
  5   | 
  6   | // 8文字以上のテスト用アカウント定義
  7   | const INITIAL_USERS = [
  8   |   { id: 'testmaster01', name: 'マスター管理者', password: 'Str0ng!Pass#2026', role: 'master' },
  9   |   { id: 'testsub01', name: 'サブ管理者', password: 'Str0ng!Pass#2026', role: 'submaster' },
  10  |   { id: 'testuser01', name: '一般太郎', password: 'Str0ng!Pass#2026', role: 'general' },
  11  | ];
  12  | 
  13  | async function resetBrowserStorage(page, { seedDbConfig = false } = {}) {
  14  |   await page.goto(`${BASE_URL}/LoginTitle.html`);
  15  |   await page.evaluate((shouldSeed) => {
  16  |     localStorage.clear();
  17  |     sessionStorage.clear();
  18  |     if (shouldSeed) {
  19  |       localStorage.setItem('dbConfig', JSON.stringify({ enabled: true }));
  20  |     }
  21  |   }, seedDbConfig);
  22  | }
  23  | 
  24  | async function getCsrfToken(request) {
  25  |   const res = await request.post(`${BASE_URL}/auth_api.php`, {
  26  |     data: { action: 'session_status' },
  27  |   });
  28  |   const body = await res.json().catch(() => ({}));
  29  |   if (!res.ok() || !body.csrfToken) {
  30  |     throw new Error(`Failed to fetch CSRF token (${res.status()}): ${body.message || 'unknown error'}`);
  31  |   }
  32  |   return body.csrfToken;
  33  | }
  34  | 
  35  | async function ensureUsersRegistered(request, users) {
  36  |   const csrfToken = await getCsrfToken(request);
  37  | 
  38  |   for (const user of users) {
  39  |     if (user.role && user.role !== 'general') {
  40  |       continue;
  41  |     }
  42  | 
  43  |     const res = await request.post(`${BASE_URL}/auth_api.php`, {
  44  |       headers: {
  45  |         'X-CSRF-Token': csrfToken,
  46  |       },
  47  |       data: {
  48  |         action: 'register_user',
  49  |         csrfToken,
  50  |         name: user.name,
  51  |         id: user.id,
  52  |         password: user.password,
  53  |         role: 'general',
  54  |       },
  55  |     });
  56  | 
  57  |     const statusCode = res.status();
  58  |     const body = await res.json().catch(() => ({}));
  59  | 
  60  |     if (statusCode === 409 && body.status !== 'success') {
  61  |       continue;
  62  |     }
  63  | 
  64  |     if (!res.ok() || body.status !== 'success') {
  65  |       throw new Error(
  66  |         `Failed to seed user ${user.id} (${statusCode}): ${body.message || 'unknown error'}`
  67  |       );
  68  |     }
  69  |   }
  70  | }
  71  | 
  72  | async function cleanupTestUsers() {
  73  |   // auth_api.php に cleanup_test_users アクションは存在しないためスキップ
  74  | }
  75  | 
  76  | async function submitLoginAndWaitComplete(page, { name, id, password }, timeout = 8000) {
  77  |   let lastAuthResponse = null;
  78  | 
  79  |   const onResponse = async res => {
  80  |     if (res.url().includes('auth_api.php')) {
  81  |       const json = await res.json().catch(() => null);
  82  |       lastAuthResponse = { status: res.status(), body: json };
  83  |     }
  84  |   };
  85  | 
  86  |   page.on('response', onResponse);
  87  |   try {
  88  |     await page.fill('#nameInput', name);
  89  |     await page.fill('#idInput', id);
  90  |     await page.fill('#passInput', password);
  91  |     await page.click('button[type="submit"]');
  92  | 
  93  |     await page.waitForURL(`${BASE_URL}/LoginComplete.html`, { timeout });
  94  |   } catch (err) {
  95  |     const errorMessage = await page.locator('#errorMessage').textContent().catch(() => '');
> 96  |     throw new Error(
      |           ^ Error: LoginComplete.html へ遷移できませんでした (url=http://loginsystem.test/LoginTitle.html, errorMessage="このIDは登録されていません。新規登録を行ってください。", authApi={"status":401,"body":{"status":"error","message":"このIDは登録されていません。新規登録を行ってください。"}})
  97  |       `LoginComplete.html へ遷移できませんでした (url=${page.url()}, errorMessage="${errorMessage}", authApi=${JSON.stringify(lastAuthResponse)})`
  98  |     );
  99  |   } finally {
  100 |     page.off('response', onResponse);
  101 |   }
  102 | }
  103 | 
  104 | test.describe('ログインおよび管理システムのE2E自動テスト', () => {
  105 |   test.beforeEach(async ({ page, request }) => {
  106 |     await ensureUsersRegistered(request, INITIAL_USERS);
  107 | 
  108 |     await page.context().clearCookies();
  109 |     await page.goto(`${BASE_URL}/LoginTitle.html`);
  110 |     await page.evaluate(() => {
  111 |       localStorage.clear();
  112 |       sessionStorage.clear();
  113 |     });
  114 |   });
  115 | 
  116 |   async function loginAndAssertRedirect(page, { name, id, password }, timeout = 8000) {
  117 |     let apiResult = null;
  118 |     const onResponse = async res => {
  119 |       if (res.url().includes('auth_api.php')) {
  120 |         apiResult = { status: res.status(), body: await res.json().catch(() => null) };
  121 |       }
  122 |     };
  123 |     page.on('response', onResponse);
  124 | 
  125 |     try {
  126 |       await page.fill('#nameInput', name);
  127 |       await page.fill('#idInput', id);
  128 |       await page.fill('#passInput', password);
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
```