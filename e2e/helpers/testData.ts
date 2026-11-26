// e2e/helpers/testData.ts
import { Page, expect } from '@playwright/test';

export interface TestUser {
  id: string;
  name: string;
  password: string;
  role?: 'master' | 'submaster' | 'general';
}

export function createUniqueUser(prefix = 'user', role: TestUser['role'] = 'general'): TestUser {
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `${prefix}_${unique}`,
    name: `${prefix}_${unique}`,
    password: `Pass_${unique}!`,
    role,
  };
}

export async function loginViaUi(page: Page, user: Pick<TestUser, 'name' | 'id' | 'password'>): Promise<void> {
  await page.getByLabel(/名前|name/i).fill(user.name);
  await page.getByLabel(/^ID$|ユーザーID/i).fill(user.id);
  await page.getByLabel(/パスワード|password/i).fill(user.password);

  await Promise.all([
    page.waitForResponse((res) => res.url().includes('Auth') && res.status() < 500),
    page.getByRole('button', { name: /ログイン|login/i }).click(),
  ]);
}