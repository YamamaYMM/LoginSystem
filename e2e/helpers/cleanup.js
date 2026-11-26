// e2e/helpers/cleanup.js
/**
 * @typedef {Object} RunTracker
 * @property {string} suffix
 * @property {(prefix?: string) => string} uniqueId
 * @property {(id: string) => void} trackUserId
 * @property {() => string[]} getTrackedUserIds
 * @property {() => void} clearTrackedUserIds
 */

/**
 * @param {import('@playwright/test').Page | null | undefined} page
 * @returns {Promise<void>}
 */
async function clearPageStorage(page) {
  if (!page || page.isClosed()) return;

  const url = page.url();
  if (!url || url === 'about:blank') return;

  await page.evaluate(() => {
    localStorage.removeItem('db_connection_enabled');
    localStorage.removeItem('system_notifications');
    localStorage.removeItem('userList');
    localStorage.removeItem('active_sessions');
    localStorage.removeItem('dbConfig');
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * @returns {RunTracker}
 */
function createRunTracker() {
  const suffix = `${Date.now().toString().slice(-6)}_${Math.random().toString(36).slice(2, 6)}`;
  const createdUserIds = new Set();

  return {
    suffix,
    uniqueId(prefix = 'e2e_u') {
      const id = `${prefix}_${suffix}`;
      createdUserIds.add(id);
      return id;
    },
    trackUserId(id) {
      if (id) createdUserIds.add(id);
    },
    getTrackedUserIds() {
      return Array.from(createdUserIds);
    },
    clearTrackedUserIds() {
      createdUserIds.clear();
    },
  };
}

module.exports = {
  clearPageStorage,
  createRunTracker,
};