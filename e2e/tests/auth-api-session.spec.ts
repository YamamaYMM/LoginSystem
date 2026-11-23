import { test, expect } from '@playwright/test';

test.describe('auth_api.php session & CSRF flow', () => {
  test('session_status returns csrfToken and rejects unauthenticated mutation without CSRF', async ({ request }) => {
    const statusRes = await request.post('auth_api.php', {
      data: { action: 'session_status' },
    });
    expect(statusRes.ok(), `Expected OK response, got ${statusRes.status()}`).toBeTruthy();

    const statusJson = await statusRes.json();
    expect(statusJson.status).toBe('success');
    expect(statusJson.authenticated).toBe(false);
    expect(typeof statusJson.csrfToken).toBe('string');

    const blockedRes = await request.post('auth_api.php', {
      data: {
        action: 'register_user',
        name: 'テストユーザー',
        id: 'e2e_user_01',
        password: 'Password123',
        role: 'general',
      },
    });
    expect(blockedRes.status()).toBeGreaterThanOrEqual(400);
  });
});