// js/ui/managerView.js
import { AuthApi } from '../api/authApi.js';
import { AppState } from '../state/appState.js';

const DB_ENABLED_KEY = 'db_connection_enabled';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class ManagerView {
  constructor(api, state) {
    this.api = api;
    this.state = state;
    this.canManageDatabase = false;
  }

  async init() {
    this.bindErrorNotificationObserver();
    this.bindNotificationMenu();
    this.bindNavigationButtons();
    this.bindForcedLogoutListener();

    // 1. 未認証チェック
    if (!this.state.isLoggedIn() || !this.state.getCurrentUserName()) {
      const pageTitle = document.getElementById('pageTitle');
      const errorEl = document.getElementById('errorMessage');
      if (pageTitle) pageTitle.style.display = 'none';
      if (errorEl) errorEl.textContent = '不正アクセス検知';
      this.state.addNotification('⚠️ 不正アクセス検知: 未認証のユーザーが loginmanager.html へアクセスしました', true);
      this.renderNotifications();
      setTimeout(() => {
        window.location.href = 'LoginTitle.html';
      }, 2000);
      return;
    }

    const mainContent = document.getElementById('mainContent');
    if (mainContent) mainContent.style.display = 'block';

    // 2. サーバー側セッションとロール検証
    const sessionUser = await this.state.syncSessionWithServer();
    const role = sessionUser?.role || this.state.getCurrentUser()?.role || 'general';
    this.canManageDatabase = role === 'master' || role === 'submaster';

    this.bindDbControls();
    this.applyPermissionState();

    this.state.updateHeartbeat();
    this.renderNotifications();
    this.updateStatus();

    if (this.canManageDatabase) {
      await this.loadLogsFromDatabase();
    }

    setInterval(() => {
      this.state.updateHeartbeat();
      this.updateStatus();
    }, 1000);
  }

  bindErrorNotificationObserver() {
    const errorMessage = document.getElementById('errorMessage');
    const notificationArea = document.getElementById('notificationArea');
    if (!errorMessage || !notificationArea) return;

    const updateVisibility = () => {
      notificationArea.hidden = Boolean(errorMessage.textContent.trim());
    };
    updateVisibility();

    new MutationObserver(updateVisibility).observe(errorMessage, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  getNotifications() {
    try {
      return JSON.parse(localStorage.getItem('system_notifications')) || [];
    } catch {
      return [];
    }
  }

  renderNotifications() {
    const list = this.getNotifications();
    const countEl = document.getElementById('notificationCount');
    const listEl = document.getElementById('notificationList');

    if (countEl) countEl.textContent = String(list.length);
    if (!listEl) return;

    if (list.length === 0) {
      listEl.innerHTML = '通知はありません。';
      return;
    }

    listEl.innerHTML = list
      .map(
        item => `
        <div class="notification-item ${item.isAlert ? 'alert' : ''}">
          <div style="font-weight: bold; font-size: 0.75em; color: #555;">${escapeHtml(item.time)}</div>
          <div>${escapeHtml(item.message)}</div>
        </div>
      `
      )
      .join('');
  }

  bindNotificationMenu() {
    const toggleBtn = document.getElementById('notificationToggle');
    const dropdown = document.getElementById('notificationDropdown');
    const clearBtn = document.getElementById('clearNotifications');

    if (toggleBtn && dropdown) {
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
      });
      dropdown.addEventListener('click', e => e.stopPropagation());
      document.addEventListener('click', () => {
        dropdown.style.display = 'none';
      });
    }

    clearBtn?.addEventListener('click', () => {
      localStorage.removeItem('system_notifications');
      this.renderNotifications();
    });

    window.addEventListener('storage', e => {
      if (e.key === 'system_notifications') {
        this.renderNotifications();
      }
    });
  }

  bindNavigationButtons() {
    document.getElementById('backToCompleteButton')?.addEventListener('click', () => {
      window.location.href = 'LoginComplete.html';
    });
  }

  bindForcedLogoutListener() {
    window.addEventListener('storage', async event => {
      if (!event.key || !event.key.startsWith('forcedLogout:') || event.newValue === null) return;
      const targetId = decodeURIComponent(event.key.slice('forcedLogout:'.length));
      const me = this.state.getCurrentUser();
      if (me && me.id === targetId) {
        localStorage.removeItem(event.key);
        await this.state.clearSessionAsync();
        alert('管理者によってログアウトされました。');
        window.location.href = 'LoginTitle.html';
      }
    });
  }

  updateStatus() {
    const isLoggedIn = this.state.isLoggedIn();
    const userName = this.state.getCurrentUserName();
    const currentTabId = this.state.tabId;
    const loginStatusEl = document.getElementById('loginStatus');

    if (loginStatusEl) {
      if (isLoggedIn && userName) {
        const now = Date.now();
        const otherCount = this.state
          .getActiveSessions()
          .filter(s => s.tabId !== currentTabId && now - s.timestamp < 10000).length;
        const otherUsersText = otherCount > 0 ? ` (ほか ${otherCount}人)` : '';
        loginStatusEl.innerHTML = `<span class="status-ok">ログイン中</span> (${escapeHtml(userName)}さん${otherUsersText})`;
      } else {
        loginStatusEl.innerHTML = `<span class="status-ng">未ログイン (ログアウト中)</span>`;
      }
    }

    const lockUntil = sessionStorage.getItem('submit_lock_until');
    const lockStatusEl = document.getElementById('lockStatus');
    if (lockStatusEl) {
      if (lockUntil) {
        const remaining = parseInt(lockUntil, 10) - Date.now();
        if (remaining > 0) {
          const min = Math.floor(remaining / 60000);
          const sec = Math.floor((remaining % 60000) / 1000);
          const timeStr = `${min}分 ${String(sec).padStart(2, '0')}秒`;
          lockStatusEl.innerHTML = `<span class="status-ng">ロック中 (残り ${timeStr})</span>`;
        } else {
          sessionStorage.removeItem('submit_lock_until');
          sessionStorage.removeItem('validationErrorCount');
          lockStatusEl.innerHTML = `<span class="status-ok">正常 (ロックなし)</span>`;
        }
      } else {
        lockStatusEl.innerHTML = `<span class="status-ok">正常 (ロックなし)</span>`;
      }
    }

    const currentHour = new Date().getHours();
    const isRestrictedTime = currentHour >= 22 || currentHour < 7;
    const timeStatusEl = document.getElementById('timeRestrictionStatus');
    if (timeStatusEl) {
      if (isRestrictedTime) {
        timeStatusEl.innerHTML = `<span class="status-ng">制限中 (現在はログイン不可の時間帯です)</span>`;
      } else {
        timeStatusEl.innerHTML = `<span class="status-ok">許可 (ログイン可能な時間帯です)</span>`;
      }
    }
  }

  applyPermissionState() {
    const controlIds = ['resetButton', 'dbConnectionToggle'];
    const table = document.getElementById('userTable');
    const statusMsg = document.getElementById('dbStatusMessage');

    if (!this.canManageDatabase) {
      controlIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = true;
        el.style.opacity = '0.5';
        el.style.cursor = 'not-allowed';
      });
      if (statusMsg) {
        statusMsg.style.color = '#b00020';
        statusMsg.textContent = 'DB設定: マスター／サブマスターのみ操作可能です';
      }
      if (table) table.style.display = 'none';
    }
  }

  isDbConnectionEnabled() {
    return localStorage.getItem(DB_ENABLED_KEY) === '1';
  }

  setDbConnectionEnabled(enabled) {
    if (enabled) {
      localStorage.setItem(DB_ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(DB_ENABLED_KEY);
    }
  }

  syncToggleUi(isOn) {
    const toggle = document.getElementById('dbConnectionToggle');
    const label = document.getElementById('dbToggleLabel');
    if (toggle) toggle.checked = Boolean(isOn);
    if (label) {
      label.textContent = isOn ? 'ON' : 'OFF';
      label.style.color = isOn ? 'green' : 'gray';
    }
  }

  applyDisconnectedUi(message = '接続状態: OFF（切断中）') {
    const statusMsg = document.getElementById('dbStatusMessage');
    this.syncToggleUi(false);
    this.toggleTableDisplay(false);
    if (statusMsg) {
      statusMsg.style.color = 'gray';
      statusMsg.textContent = message;
    }
  }

  applyConnectedUi(message = '接続状態: ON（環境変数接続中）') {
    const statusMsg = document.getElementById('dbStatusMessage');
    this.syncToggleUi(true);
    if (statusMsg) {
      statusMsg.style.color = 'green';
      statusMsg.textContent = message;
    }
  }

  setResetButtonEnabled(enabled) {
    const resetBtn = document.getElementById('resetButton');
    if (!resetBtn) return;
    resetBtn.disabled = !enabled;
    resetBtn.style.opacity = enabled ? '1' : '0.5';
    resetBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
  }

  toggleTableDisplay(show, data = []) {
    const table = document.getElementById('userTable');
    if (!table) return;

    while (table.rows.length > 1) {
      table.deleteRow(1);
    }

    if (!show) {
      table.style.display = 'none';
      this.setResetButtonEnabled(false);
      return;
    }

    table.style.display = 'table';
    const hasData = Array.isArray(data) && data.length > 0;
    this.setResetButtonEnabled(hasData);

    data.forEach(userRow => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = userRow.name || '-';

      const idCell = document.createElement('td');
      idCell.textContent = userRow.id || '-';

      const timeCell = document.createElement('td');
      timeCell.textContent = userRow.time || '不明';

      row.append(nameCell, idCell, timeCell);
      table.appendChild(row);
    });
  }

  async loadLogsFromDatabase() {
    if (!this.canManageDatabase) return;
    if (!this.isDbConnectionEnabled()) {
      this.toggleTableDisplay(false);
      return;
    }

    try {
      const data = await this.api.getLoginLogs(null);
      if (data?.status === 'success') {
        this.toggleTableDisplay(true, data.data || []);
      } else {
        this.toggleTableDisplay(false);
      }
    } catch (err) {
      console.error('ログ取得エラー:', err);
      this.toggleTableDisplay(false);
    }
  }

  bindDbControls() {
    if (!this.canManageDatabase) return;

    const statusMsg = document.getElementById('dbStatusMessage');
    if (this.isDbConnectionEnabled()) {
      this.applyConnectedUi();
    } else {
      this.applyDisconnectedUi();
    }

    document.getElementById('dbConnectionToggle')?.addEventListener('change', async e => {
      const turnOn = Boolean(e.target.checked);

      if (!turnOn) {
        this.setDbConnectionEnabled(false);
        this.applyDisconnectedUi('接続状態: OFF（切断中）');
        return;
      }

      try {
        const data = await this.api.connectAndInitDatabase(null);
        if (data?.status === 'success') {
          this.setDbConnectionEnabled(true);
          this.applyConnectedUi('接続状態: ON（接続中）');
          await this.loadLogsFromDatabase();
        } else {
          console.error('connectAndInitDatabase 失敗:', data);
          this.setDbConnectionEnabled(false);
          e.target.checked = false;
          this.applyDisconnectedUi(`接続状態: 接続失敗 (${data?.message || 'エラー'})`);
          if (statusMsg) statusMsg.style.color = 'red';
        }
      } catch (err) {
        console.error('connectAndInitDatabase 失敗:', err);
        this.setDbConnectionEnabled(false);
        e.target.checked = false;
        this.applyDisconnectedUi('接続状態: 通信エラー');
        if (statusMsg) statusMsg.style.color = 'red';
      }
    });

    document.getElementById('resetButton')?.addEventListener('click', async () => {
      if (!confirm('本当にデータベースのログイン履歴をすべてリセットしますか？')) return;
      if (!this.isDbConnectionEnabled()) {
        alert('データベース接続がOFFになっています');
        return;
      }
      try {
        const data = await this.api.resetLoginLogs(null);
        if (data?.status === 'success') {
          localStorage.removeItem('userList');
          this.toggleTableDisplay(true, []);
          alert(data.message);
        } else {
          alert('リセットに失敗しました: ' + (data?.message || ''));
        }
      } catch (err) {
        alert(err.message || 'リセット処理の送信に失敗しました');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const api = new AuthApi();
  const state = new AppState(api);
  const view = new ManagerView(api, state);
  view.init();
});