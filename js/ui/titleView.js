// js/ui/titleView.js
import { AuthApi } from '../api/authApi.js';
import { AppState } from '../state/appState.js';

const COMMON_WEAK_PASSWORDS = [
  'password', 'password123', '12345678', 'qwertyui', 'qwerty123',
  'admin123', 'testtest', '11111111', '123456789', '1234567890',
  '00000000', 'abc12345', 'iloveyou1', 'abcdefgh', 'welcome1',
];

const LOCK_DURATION = 300000; // 5分

class TitleView {
  constructor(api, state) {
    this.api = api;
    this.state = state;
    this.validationErrorCount = parseInt(sessionStorage.getItem('validationErrorCount') || '0', 10);
    this.isTestEnv = false;
  }

  async init() {
    this.startClock();
    this.bindPasswordToggles();
    this.bindGuestLogin();
    this.bindForgotModal();
    this.bindLoginForm();
    this.checkLockStatus();
    await this.detectTestEnv();
  }

  async detectTestEnv() {
    try {
      const res = await fetch('auth_api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'session_status' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.appEnv === 'test') {
        this.isTestEnv = true;
      }
    } catch {
      // 取得失敗時は通常どおり時間帯制限を適用
    }
  }

  startClock() {
    const updateClock = () => {
      const now = new Date();
      const timeStr = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join(':');
      const clockEl = document.getElementById('clock');
      if (clockEl) clockEl.textContent = timeStr;
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  bindPasswordToggles() {
    const togglePass = document.getElementById('togglePassword');
    const passInput = document.getElementById('passInput');
    togglePass?.addEventListener('change', () => {
      if (passInput) passInput.type = togglePass.checked ? 'text' : 'password';
    });

    const toggleNewPass = document.getElementById('toggleNewPassword');
    const newPassInput = document.getElementById('newPasswordInput');
    const confirmNewPassInput = document.getElementById('confirmNewPasswordInput');
    toggleNewPass?.addEventListener('change', () => {
      const type = toggleNewPass.checked ? 'text' : 'password';
      if (newPassInput) newPassInput.type = type;
      if (confirmNewPassInput) confirmNewPassInput.type = type;
    });
  }

  bindGuestLogin() {
    document.getElementById('guestLoginBtn')?.addEventListener('click', () => {
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('loggedInUserId', 'ゲスト');
      sessionStorage.removeItem('loggedInId');
      this.state.addNotification('👤 ゲストログイン: ゲストユーザーとしてログインしました');
      window.location.href = 'LoginComplete.html';
    });
  }

  bindForgotModal() {
    const modal = document.getElementById('forgotModal');
    const resultEl = document.getElementById('forgotResult');

    document.getElementById('openForgotModal')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'block';
      if (resultEl) resultEl.textContent = '';
      ['forgotNameInput', 'forgotIdInput', 'newPasswordInput', 'confirmNewPasswordInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    });

    document.getElementById('closeForgotModal')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });

    window.addEventListener('click', event => {
      if (event.target === modal && modal) modal.style.display = 'none';
    });

    document.getElementById('searchAccountBtn')?.addEventListener('click', async () => {
      const name = document.getElementById('forgotNameInput')?.value.trim() || '';
      const id = document.getElementById('forgotIdInput')?.value.trim() || '';
      const newPassword = document.getElementById('newPasswordInput')?.value || '';
      const confirmPassword = document.getElementById('confirmNewPasswordInput')?.value || '';

      if (!name || !id || !newPassword) {
        resultEl.style.color = 'red';
        resultEl.textContent = 'お名前、ID、新しいパスワードをすべて入力してください。';
        return;
      }
      if (newPassword !== confirmPassword) {
        resultEl.style.color = 'red';
        resultEl.textContent = '新しいパスワードと確認用パスワードが一致しません。';
        return;
      }
      if (
        newPassword.length < 8 ||
        /^(.)\1+$/u.test(newPassword) ||
        COMMON_WEAK_PASSWORDS.includes(newPassword.toLowerCase())
      ) {
        resultEl.style.color = 'red';
        resultEl.textContent = '8文字以上で、推測されにくいパスワードを入力してください。';
        return;
      }

      try {
        await this.api.resetPassword({ name, id, newPassword });
        resultEl.style.color = 'green';
        resultEl.textContent = 'パスワードを変更しました。新しいパスワードでログインしてください。';
        this.state.addNotification(`ℹ️ パスワード変更: (${name}) のパスワードが変更されました`);
      } catch (err) {
        resultEl.style.color = 'red';
        resultEl.textContent = err.message || 'パスワードの変更に失敗しました。';
      }
    });
  }

  activateLock(duration) {
    const submitBtn = document.querySelector('#loginForm button[type="submit"]');
    const errorEl = document.getElementById('errorMessage');
    if (submitBtn) submitBtn.disabled = true;
    if (errorEl) {
      errorEl.textContent = '後でログインしなおしてください';
      errorEl.style.color = 'green';
    }

    setTimeout(() => {
      if (submitBtn) submitBtn.disabled = false;
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.color = 'red';
      }
      this.validationErrorCount = 0;
      sessionStorage.removeItem('validationErrorCount');
      sessionStorage.removeItem('submit_lock_until');
    }, duration);
  }

  checkLockStatus() {
    const lockUntil = sessionStorage.getItem('submit_lock_until');
    if (!lockUntil) return;
    const remaining = parseInt(lockUntil, 10) - Date.now();
    if (remaining > 0) {
      this.activateLock(remaining);
    } else {
      sessionStorage.removeItem('submit_lock_until');
      sessionStorage.removeItem('validationErrorCount');
      this.validationErrorCount = 0;
    }
  }

  validateInput(nameValue, idValue, passValue) {
    const currentHour = new Date().getHours();
    const isRestrictedTime = !this.isTestEnv && (currentHour >= 22 || currentHour < 7);

    if (isRestrictedTime) return { error: '現在はログインできない時間帯です', isRestrictedTime: true };
    if (!nameValue || idValue === '' || passValue === '') {
      return { error: 'お名前、ID、パスワードをすべて入力してください' };
    }
    if (idValue.length <= 7) return { error: 'IDは8文字以上入力してください' };
    if (passValue.length <= 7) return { error: 'パスワードは8文字以上入力してください' };
    if (/^(.)\1+$/u.test(idValue) || /^(.)\1+$/u.test(passValue)) {
      return { error: '同じ文字の繰り返しはできません' };
    }
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(idValue)) {
      return { error: 'ひらがな・カタカナ・漢字は使用できません' };
    }
    if (COMMON_WEAK_PASSWORDS.includes(passValue.toLowerCase())) {
      return { error: '推測されやすい危険なパスワードは使用できません' };
    }
    if (/[\uFF01-\uFF60\uFFE0-\uFFE6]/.test(idValue)) {
      return { error: '全角文字は使用できません' };
    }

    // 重複ログインチェック
    const now = Date.now();
    const activeOthers = this.state.getActiveSessions().filter(
      s => s.tabId !== this.state.tabId && s.userId === idValue && now - s.timestamp < 10000
    );
    if (activeOthers.length > 0) {
      return { error: 'このアカウントはすでにログインしています' };
    }

    return { error: '' };
  }

  recordFailure(errorText, idValue, isRestrictedTime = false) {
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) {
      errorEl.style.color = 'red';
      errorEl.textContent = errorText;
    }

    this.validationErrorCount += 1;
    sessionStorage.setItem('validationErrorCount', String(this.validationErrorCount));

    const isAlert = isRestrictedTime || this.validationErrorCount >= 8;
    this.state.addNotification(
      `ログイン試行失敗: ${errorText} (ID: ${idValue || '未入力'})`,
      isAlert
    );

    if (this.validationErrorCount >= 8) {
      const lockUntil = Date.now() + LOCK_DURATION;
      sessionStorage.setItem('submit_lock_until', String(lockUntil));
      this.activateLock(LOCK_DURATION);
      this.state.addNotification('⚠️ セキュリティ警告: 試行回数超過によりログイン機能がロックされました', true);
    }
  }

showLoggingInOverlay() {
    if (document.getElementById('loginLoadingOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'loginLoadingOverlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'background:rgba(255, 255, 255, 0.85)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#111111',
      'font-size:1.25rem',
      'font-weight:bold',
    ].join(';');

    overlay.textContent = 'ログイン中...';
    document.body.appendChild(overlay);
  }

  hideLoggingInOverlay() {
    document.getElementById('loginLoadingOverlay')?.remove();
  }

  bindLoginForm() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    form.addEventListener('keydown', event => {
      if (
        event.key === 'Enter' &&
        ['nameInput', 'idInput', 'passInput'].includes(event.target.id)
      ) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();

      const lockUntil = sessionStorage.getItem('submit_lock_until');
      if (lockUntil && parseInt(lockUntil, 10) > Date.now()) return;

      const nameValue = document.getElementById('nameInput')?.value.trim() || '';
      const idValue = document.getElementById('idInput')?.value.trim() || '';
      const passValue = document.getElementById('passInput')?.value.trim() || '';
      const errorEl = document.getElementById('errorMessage');
      const submitBtn = form.querySelector('button[type="submit"]');

      const check = this.validateInput(nameValue, idValue, passValue);
      if (check.error) {
        this.recordFailure(check.error, idValue, Boolean(check.isRestrictedTime));
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      this.showLoggingInOverlay();

      try {
        // サーバー側（PHP + MySQL）で認証・セッション発行
        const authRes = await this.api.loginSession({
          name: nameValue,
          id: idValue,
          password: passValue,
        });

        if (errorEl) errorEl.textContent = '';
        this.validationErrorCount = 0;
        sessionStorage.removeItem('validationErrorCount');

        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('loggedInUserId', authRes.user.name);
        sessionStorage.setItem('loggedInId', authRes.user.id);

        // login_session 後の最新 CSRF トークンを取得
        this.api.clearCsrfToken();
        await this.api.ensureCsrfToken();

        // 履歴DB保存
        const now = new Date();
        const loginTime =
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        try {
          await this.api.saveLogin({
            name: authRes.user.name,
            id: authRes.user.id,
            password: passValue,
            time: loginTime,
          });
        } catch (dbErr) {
          console.warn('ログイン履歴保存スキップ:', dbErr);
        }

        window.location.href = 'LoginComplete.html';
      } catch (err) {
        this.hideLoggingInOverlay();
        this.recordFailure(err.message || 'ログインに失敗しました', idValue);
      } finally {
        if (submitBtn && !sessionStorage.getItem('submit_lock_until')) {
          submitBtn.disabled = false;
        }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const api = new AuthApi();
  const state = new AppState(api);
  const view = new TitleView(api, state);
  view.init();
});