// js/state/appState.js
import { AuthApi } from '../api/authApi.js';

const KEYS = {
  USERS: 'registeredUsers',
  SESSIONS: 'active_sessions',
  MESSAGES: 'user_messages',
  NOTIFICATIONS: 'system_notifications',
  SCHEDULED_LOGOUT: 'scheduled_logout_day',
  FORCED_LOGOUT_PREFIX: 'forcedLogout:',
};
const DB_CONFIG_KEY = 'dbConfig';

const MAX_ATTACHMENT_BYTES = 1024 * 1024; // 1MB

export function isConfidentialAttachment(file) {
  if (!file || !file.name) return false;
  const normalized = file.name.replace(/\\/g, '/').toLowerCase();
  const baseName = normalized.split('/').pop();
  return (
    baseName === '.env' ||
    baseName.startsWith('.env.') ||
    /\.(pem|key)$/.test(baseName) ||
    normalized.split('/').includes('secrets')
  );
}

export class AppState {
  constructor(api = new AuthApi()) {
    this.api = api;
    this.serverUser = null; // auth_api.php から取得したセッションユーザー情報
    this.usersCache = null; // サーバーから取得したユーザー一覧キャッシュ
    this.isTestEnv = false;
    this.tabId = sessionStorage.getItem('tabId');
    if (!this.tabId) {
      this.tabId = 'tab_' + Math.random().toString(36).substring(2);
      sessionStorage.setItem('tabId', this.tabId);
    }
    this.forceLogoutHandled = false;
  }

  // --- 認証・セッション同期 ---
  isLoggedIn() {
    return sessionStorage.getItem('isLoggedIn') === 'true';
  }

  getCurrentUserName() {
    return sessionStorage.getItem('loggedInUserId');
  }

  getUsers() {
    if (Array.isArray(this.usersCache)) {
      return this.usersCache;
    }
    try {
      return JSON.parse(localStorage.getItem(KEYS.USERS)) || [];
    } catch {
      return [];
    }
  }

  saveUsers(users) {
    this.usersCache = Array.isArray(users) ? users : [];
    localStorage.setItem(KEYS.USERS, JSON.stringify(this.usersCache));
  }

  disconnectDatabaseState() {
    localStorage.removeItem(DB_CONFIG_KEY);
  }

  async refreshUsersFromServer() {
    try {
      const res = await this.api.listUsers();
      if (res && res.status === 'success' && Array.isArray(res.users)) {
        this.usersCache = res.users;
        return res.users;
      }
    } catch (err) {
      console.warn('サーバーからのユーザー一覧取得に失敗しました:', err);
    }
    return this.getUsers();
  }

  getCurrentUser() {
    if (this.serverUser && this.serverUser.id) {
      const localMatch = this.getUsers().find(u => u.id === this.serverUser.id);
      return localMatch
        ? { ...localMatch, role: this.serverUser.role, name: this.serverUser.name || localMatch.name }
        : this.serverUser;
    }

    const name = this.getCurrentUserName();
    if (!name || name === 'ゲスト') return null;
    return this.getUsers().find(u => u.name === name || u.id === name) || null;
  }

  async syncSessionWithServer() {
    if (!this.isLoggedIn() || this.getCurrentUserName() === 'ゲスト') {
      this.serverUser = null;
      return null;
    }

    try {
      const res = await this.api.getSessionStatus();
      if (res && res.appEnv === 'test') {
        this.isTestEnv = true;
      }
      if (res && res.authenticated && res.user) {
        this.serverUser = res.user;
        await this.refreshUsersFromServer();
        return res.user;
      }
    } catch (err) {
      console.warn('セッション同期に失敗しました:', err);
    }
    return null;
  }

  clearSessionLocal() {
    const sessions = this.getActiveSessions().filter(s => s.tabId !== this.tabId);
    localStorage.setItem(KEYS.SESSIONS, JSON.stringify(sessions));

    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('loggedInUserId');
    sessionStorage.removeItem('loggedInId');
    sessionStorage.removeItem('tabId');
    this.serverUser = null;
  }

  clearSession() {
    this.clearSessionLocal();
  }

  async clearSessionAsync() {
    this.clearSessionLocal();
    try {
      await this.api.logoutSession();
    } catch (err) {
      console.warn('サーバー側ログアウト通知に失敗しました:', err);
    }
  }

  // --- スケジュールログアウト・ハートビート ---
  getLogoutWindowDay(now = Date.now()) {
    const date = new Date(now);
    if (date.getHours() < 6) date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  checkScheduledLogout() {
    if (this.isTestEnv) return false;

    const now = new Date();
    const hour = now.getHours();
    if (hour < 22 && hour >= 6) return false;

    const windowDay = this.getLogoutWindowDay(now.getTime());
    if (localStorage.getItem(KEYS.SCHEDULED_LOGOUT) !== windowDay) {
      localStorage.setItem(KEYS.SCHEDULED_LOGOUT, windowDay);
      localStorage.setItem(KEYS.SESSIONS, '[]');
    }
    if (this.isLoggedIn()) {
      this.clearSessionAsync();
      window.location.href = 'LoginTitle.html';
    }
    return true;
  }

  getActiveSessions() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.SESSIONS)) || [];
    } catch {
      return [];
    }
  }

  isUserOnline(userId) {
    const now = Date.now();
    return this.getActiveSessions().some(
      s => s.userId === userId && now - s.timestamp < 10000
    );
  }

  updateHeartbeat() {
    if (this.checkScheduledLogout()) return;

    const now = Date.now();
    let sessions = this.getActiveSessions().filter(s => now - s.timestamp < 10000);
    const idx = sessions.findIndex(s => s.tabId === this.tabId);

    if (this.isLoggedIn()) {
      const payload = {
        tabId: this.tabId,
        userId: sessionStorage.getItem('loggedInId') || '',
        userName: this.getCurrentUserName() || 'ゲスト',
        timestamp: now,
      };
      if (idx >= 0) sessions[idx] = payload;
      else sessions.push(payload);
    } else if (idx >= 0) {
      sessions.splice(idx, 1);
    }

    localStorage.setItem(KEYS.SESSIONS, JSON.stringify(sessions));
  }

  // --- 権限・管理操作（サーバー検証連携） ---
  canForceLogout(actor, target) {
    if (!actor || !target || actor.id === target.id) return false;
    if (actor.role === 'master') return target.role !== 'master';
    if (actor.role === 'submaster') {
      return target.role !== 'master' && target.role !== 'submaster';
    }
    return false;
  }

  async requestForcedLogoutAsync(targetId) {
    const users = this.getUsers();
    const authRes = await this.api.authorizeForceLogout(targetId, users);
    if (!authRes || authRes.status !== 'success') {
      throw new Error((authRes && authRes.message) || '強制ログアウトが拒否されました。');
    }

    const target = users.find(u => u.id === targetId) || {
      id: targetId,
      name: authRes.targetName || targetId,
    };

    const key = `${KEYS.FORCED_LOGOUT_PREFIX}${encodeURIComponent(targetId)}`;
    localStorage.setItem(key, `${Date.now()}-${Math.random()}`);
    return target;
  }

  consumeForcedLogoutSignal() {
    if (this.forceLogoutHandled) return false;
    const me = this.getCurrentUser();
    if (!me || !me.id) return false;

    const key = `${KEYS.FORCED_LOGOUT_PREFIX}${encodeURIComponent(me.id)}`;
    if (localStorage.getItem(key) === null) return false;

    this.forceLogoutHandled = true;
    localStorage.removeItem(key);
    return true;
  }

  async toggleManagerRoleAsync(targetId) {
    const users = this.getUsers();
    const res = await this.api.toggleManagerRole(targetId, users);
    if (!res || res.status !== 'success' || !Array.isArray(res.users)) {
      throw new Error((res && res.message) || '権限変更に失敗しました。');
    }

    this.saveUsers(res.users);
    const updated = res.target;
    if (updated) {
      this.addNotification(
        `🔧 権限変更: ユーザー (${updated.name}) に${updated.isManager ? '管理権限の付与' : '管理権限の剥奪'}が実行されました`
      );
    }
    return updated;
  }

  async deleteUserAsync(targetId) {
    const users = this.getUsers();
    const res = await this.api.deleteUser(targetId, users);
    if (!res || res.status !== 'success' || !Array.isArray(res.users)) {
      throw new Error((res && res.message) || 'ユーザー削除に失敗しました。');
    }

    this.saveUsers(res.users);
    if (res.databaseDropped) {
      this.disconnectDatabaseState();
    }

    const deleted = res.deleted;
    if (deleted) {
      this.addNotification(
        `🗑️ アカウント削除: ユーザー (${deleted.name}) が管理者により削除されました`,
        true
      );
    }
    return deleted;
  }

  async deleteSelfAsync() {
    const res = await this.api.deleteSelf();
    if (!res || res.status !== 'success') {
      throw new Error((res && res.message) || 'アカウントの削除に失敗しました。');
    }

    if (res.databaseDropped) {
      this.disconnectDatabaseState();
    }

    this.usersCache = null;
    localStorage.removeItem(KEYS.USERS);
    this.clearSessionLocal();
    this.addNotification('🗑️ ユーザー削除: 自身がアカウントを削除しました', true);
    return Boolean(res.databaseDropped);
  }

  async changePasswordAsync(currentPass, newPass, confirmPass) {
    if (currentPass === '') {
      return { ok: false, error: '現在のパスワードを入力してください。' };
    }
    if (newPass === '') {
      return { ok: false, error: '新しいパスワードを入力してください。' };
    }
    if (confirmPass === '') {
      return { ok: false, error: '確認用パスワードを入力してください。' };
    }

    const me = this.getCurrentUser();
    if (!me) {
      return { ok: false, error: 'ユーザー情報が見つかりません。' };
    }
    if (newPass === currentPass) {
      return { ok: false, error: '新しいパスワードは現在のパスワードと同じにできません。' };
    }
    if (newPass.length < 8) {
      return { ok: false, error: '新しいパスワードは8文字以上で入力してください。' };
    }
    if (/^(.)\1+$/.test(newPass)) {
      return { ok: false, error: '同じ文字だけの繰り返しはパスワードとして使用できません。' };
    }
    if (newPass !== confirmPass) {
      return { ok: false, error: '新しいパスワードと確認用パスワードが一致しません。' };
    }

    try {
      const res = await this.api.changePassword(currentPass, newPass);
      if (!res || res.status !== 'success') {
        return { ok: false, error: (res && res.message) || 'パスワードの変更に失敗しました。' };
      }
      this.addNotification(`🔑 パスワード変更: ユーザー (${me.name}) がパスワードを変更しました`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'パスワードの変更に失敗しました。' };
    }
  }

  // --- メッセージ管理 ---
  getMessages() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.MESSAGES)) || [];
    } catch {
      return [];
    }
  }

  saveMessages(messages) {
    localStorage.setItem(KEYS.MESSAGES, JSON.stringify(messages));
  }

  getUnreadMessagesForCurrentUser() {
    const me = this.getCurrentUser();
    if (!me) return [];
    return this.getMessages()
      .filter(m => m.toId === me.id && !m.read)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getInboxMessages() {
    const me = this.getCurrentUser();
    if (!me) return [];
    return this.getMessages()
      .filter(m => m.toId === me.id)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getSentMessages() {
    const me = this.getCurrentUser();
    if (!me) return [];
    return this.getMessages()
      .filter(m => m.fromId === me.id)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  markInboxAsRead() {
    const me = this.getCurrentUser();
    if (!me) return false;
    const all = this.getMessages();
    let changed = false;
    all.forEach(m => {
      if (m.toId === me.id && !m.read) {
        m.read = true;
        changed = true;
      }
    });
    if (changed) this.saveMessages(all);
    return changed;
  }

  deleteMessage(messageId) {
    const filtered = this.getMessages().filter(m => m.id !== messageId);
    this.saveMessages(filtered);
  }

  async sendMessage({ toVal, subjectVal, bodyVal, file }) {
    const me = this.getCurrentUser();
    if (!me) {
      return { ok: false, error: '送信者情報が取得できませんでした。' };
    }
    if (!toVal) {
      return { ok: false, error: '宛先を入力してください。' };
    }
    if (!subjectVal) {
      return { ok: false, error: '件名を入力してください。' };
    }
    if (!bodyVal && !file) {
      return { ok: false, error: '本文を入力してください。' };
    }
    if (file && file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: '添付ファイルは1MB以下にしてください。', clearFile: true };
    }
    if (file && isConfidentialAttachment(file)) {
      return { ok: false, error: '機密ファイルは添付できません。', clearFile: true };
    }

    const recipient = this.getUsers().find(u => u.id === toVal || u.name === toVal);
    if (!recipient) {
      return { ok: false, error: '指定された宛先のアカウントが見つかりません。' };
    }
    if (recipient.id === me.id) {
      return { ok: false, error: '自分自身にはメッセージを送信できません。' };
    }

    let attachment = null;
    if (file) {
      attachment = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result });
        reader.onerror = () => reject(new Error('ファイルを読み込めませんでした。'));
        reader.readAsDataURL(file);
      });
    }

    const messages = this.getMessages();
    messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fromId: me.id,
      fromName: me.name,
      toId: recipient.id,
      toName: recipient.name,
      subject: subjectVal,
      body: bodyVal,
      timeStr: new Date().toLocaleString(),
      timestamp: Date.now(),
      read: false,
      attachment,
    });
    this.saveMessages(messages);
    this.addNotification(`✉️ メッセージ送信: ${me.name} から ${recipient.name} へメッセージが送信されました`);

    return { ok: true, recipient };
  }

  // --- システム通知 ---
  addNotification(message, isAlert = false) {
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(KEYS.NOTIFICATIONS)) || [];
    } catch {}
    list.unshift({ message, time: new Date().toLocaleTimeString(), isAlert });
    if (list.length > 30) list.pop();
    localStorage.setItem(KEYS.NOTIFICATIONS, JSON.stringify(list));
  }
}