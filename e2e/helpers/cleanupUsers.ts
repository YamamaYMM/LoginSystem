// 例: e2e/helpers/cleanupUsers.ts （または各specに配置）
import type { APIRequestContext } from '@playwright/test';

type Credentials = {
  id: string;
  name: string;
  password: string;
};

export async function cleanupUsersWithAdmin(
  request: APIRequestContext,
  baseUrl: string,
  adminUser: Credentials,
  targetUserIds: string[]
) {
  const base = baseUrl.replace(/\/+$/, '');
  const uniqueTargets = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (uniqueTargets.length === 0) return;

  try {
    // 1. 初期CSRFトークン取得
    const statusRes = await request.post(`${base}/auth_api.php`, {
      data: { action: 'session_status' },
    });
    const statusBody = await statusRes.json().catch(() => ({}));
    const initToken = statusBody.csrfToken;
    if (!statusRes.ok() || !initToken) return;

    // 2. 管理者でログインしてセッション＆最新CSRFトークンを取得
    const loginRes = await request.post(`${base}/auth_api.php`, {
      headers: { 'X-CSRF-Token': initToken },
      data: {
        action: 'login_session',
        csrfToken: initToken,
        name: adminUser.name,
        id: adminUser.id,
        password: adminUser.password,
      },
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    if (!loginRes.ok() || loginBody.status !== 'success') return;

    const activeToken = loginBody.csrfToken || initToken;

    // 3. 対象ユーザーを削除（管理者自身が含まれる場合は delete_self へ）
    for (const targetId of uniqueTargets) {
      if (targetId === adminUser.id) {
        await request
          .post(`${base}/auth_api.php`, {
            headers: { 'X-CSRF-Token': activeToken },
            data: { action: 'delete_self', csrfToken: activeToken },
          })
          .catch(() => {});
      } else {
        await request
          .post(`${base}/auth_api.php`, {
            headers: { 'X-CSRF-Token': activeToken },
            data: { action: 'delete_user', csrfToken: activeToken, targetId },
          })
          .catch(() => {});
      }
    }
  } catch {
    // クリーンアップ失敗でテスト全体の終了を妨げない
  }
}