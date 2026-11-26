// e2e/helpers/cleanup.d.ts
import type { Page } from '@playwright/test';

export interface RunTracker {
  suffix: string;
  uniqueId(prefix?: string): string;
  trackUserId(id: string): void;
  getTrackedUserIds(): string[];
  clearTrackedUserIds(): void;
}

export declare function clearPageStorage(page: Page | null | undefined): Promise<void>;
export declare function createRunTracker(): RunTracker;