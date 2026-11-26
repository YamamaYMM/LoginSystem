// e2e/global-teardown.js
const { request } = require('@playwright/test');

const DEFAULT_PASSWORD = 'Str0ng!Pass#2026';

async function getCsrfToken(apiContext, baseUrl) {
  const res = await apiContext.post(`${baseUrl}/auth_api.php`, {
    data: { action: 'session_status' },
  });
  const body = await res.json().catch(() => ({}));
  return body.csrfToken || '';
}

async function tryDeleteMasterByLogin(apiContext, baseUrl, { id, name, password }) {
  try {
    const initToken = await getCsrfToken(apiContext, baseUrl);
    if (!initToken) return false;

    const loginRes = await apiContext.post(`${baseUrl}/auth_api.php`, {
      headers: { 'X-CSRF-Token': initToken },
      data: {
        action: 'login_session',
        csrfToken: initToken,
        id,
        name,
        password,
      },
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok() || loginBody.status !== 'success') return false;

    const activeToken = loginBody.csrfToken || initToken;
    const delRes = await apiContext.post(`${baseUrl}/auth_api.php`, {
      headers: { 'X-CSRF-Token': activeToken },
      data: {
        action: 'delete_self',
        csrfToken: activeToken,
      },
    });
    return delRes.ok();
  } catch {
    return false;
  }
}

module.exports = async () => {
  const baseUrl = (
    process.env.PLAYWRIGHT_BASE_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost/LoginSystem'
  ).replace(/\/+$/, '');

  const apiContext = await request.newContext();
  try {
    // テストスイートで作成・利用されうる代表的なテスト用マスター候補
    const candidates = [
      { id: 'testmaster01', name: 'マスター管理者', password: DEFAULT_PASSWORD },
    ];

    // 環境変数で残っている master の ID / 名前 / パスワードを指定できるようにしておく
    if (process.env.E2E_TEARDOWN_MASTER_ID) {
      candidates.unshift({
        id: process.env.E2E_TEARDOWN_MASTER_ID,
        name: process.env.E2E_TEARDOWN_MASTER_NAME || '',
        password: process.env.E2E_TEARDOWN_MASTER_PASSWORD || DEFAULT_PASSWORD,
      });
    }

    for (const user of candidates) {
      if (!user.id) continue;
      const deleted = await tryDeleteMasterByLogin(apiContext, baseUrl, user);
      if (deleted) break;
    }
  } finally {
    await apiContext.dispose();
  }
};