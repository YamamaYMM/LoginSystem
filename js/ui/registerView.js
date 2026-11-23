// js/ui/registerView.js
import { AuthApi } from '../api/authApi.js';
import { AppState } from '../state/appState.js';

const COMMON_PASSWORDS = [
  'password', 'password123', '12345678', 'qwertyui', 'qwerty123',
  'admin123', 'testtest', '11111111', '123456789', '1234567890',
  '00000000', 'abc12345', 'iloveyou1', 'abcdefgh', 'welcome1',
];

class RegisterView {
  constructor(api, state) {
    this.api = api;
    this.state = state;
  }

  enforceAsciiOnly(input, errorEl = null) {
    if (!input) return false;
    const hasNonAscii = /[^\x00-\x7F]/.test(input.value);
    if (hasNonAscii) {
      const pos = input.selectionStart ?? 0;
      const cleaned = input.value.replace(/[^\x00-\x7F]/g, '');
      input.value = cleaned;
      if (typeof input.setSelectionRange === 'function') {
        const nextPos = Math.min(pos, cleaned.length);
        input.setSelectionRange(nextPos, nextPos);
      }
      if (errorEl) {
        errorEl.textContent = 'パスワードは半角英数字・記号で入力してください';
      }
      return true;
    }
    return false;
  }

  preventFullWidthInput(input, errorEl = null) {
    if (!input) return;

    input.setAttribute('inputmode', 'latin');
    input.setAttribute('lang', 'en');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', input.getAttribute('autocomplete') || 'new-password');
    input.setAttribute('spellcheck', 'false');
    input.style.imeMode = 'disabled';

    input.addEventListener('beforeinput', e => {
      if (typeof e.data === 'string' && /[^\x00-\x7F]/.test(e.data)) {
        e.preventDefault();
        if (errorEl) {
          errorEl.textContent = 'パスワードは半角英数字・記号で入力してください';
        }
      }
    });

    const handleClean = () => {
      this.enforceAsciiOnly(input, errorEl);
    };

    input.addEventListener('compositionstart', handleClean);
    input.addEventListener('compositionupdate', handleClean);
    input.addEventListener('compositionend', handleClean);
    input.addEventListener('input', handleClean);
  }

  init() {
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('newPassInput');
    const confirmInput = document.getElementById('confirmPassInput');
    const errorEl = document.getElementById('errorMessage');

    this.preventFullWidthInput(passwordInput, errorEl);
    this.preventFullWidthInput(confirmInput, errorEl);

    togglePassword?.addEventListener('change', () => {
      const type = togglePassword.checked ? 'text' : 'password';
      if (passwordInput) {
        passwordInput.type = type;
        this.enforceAsciiOnly(passwordInput, errorEl);
      }
      if (confirmInput) {
        confirmInput.type = type;
        this.enforceAsciiOnly(confirmInput, errorEl);
      }
    });

    const form = document.getElementById('registerForm');
    if (!form) return;

    form.addEventListener('submit', async event => {
      event.preventDefault();

      const nameValue = document.getElementById('nameInput')?.value.trim() || '';
      const roleValue = document.getElementById('roleSelect')?.value || 'general';
      const newId = document.getElementById('newIdInput')?.value.trim() || '';
      const newPass = document.getElementById('newPassInput')?.value.trim() || '';
      const confirmPass = document.getElementById('confirmPassInput')?.value.trim() || '';
      const submitBtn = form.querySelector('button[type="submit"]');

      if (errorEl) errorEl.textContent = '';

      if (!nameValue || !newId || !newPass) {
        if (errorEl) errorEl.textContent = 'すべての項目を入力してください';
        return;
      }
      if (newPass !== confirmPass) {
        if (errorEl) errorEl.textContent = 'パスワードが一致しません';
        return;
      }
      if (!/^[\x21-\x7E]+$/.test(newPass) || !/^[\x21-\x7E]+$/.test(confirmPass)) {
        if (errorEl) {
          errorEl.textContent = 'パスワードは半角英数字・記号で入力してください';
        }
        return;
      }
      if (newId.length < 8 || newPass.length < 8) {
        if (errorEl) errorEl.textContent = 'IDおよびパスワードは8文字以上で入力してください';
        return;
      }
      if (nameValue.length < 2) {
        if (errorEl) errorEl.textContent = '名前は2文字以上で入力してください';
        return;
      }

      const isAllSameChar = /^(.)\1+$/.test(newPass);
      if (COMMON_PASSWORDS.includes(newPass.toLowerCase()) || isAllSameChar) {
        if (errorEl) {
          errorEl.textContent = '推測されやすいパスワード（同じ文字の連続や単純な文字列）は使用できません。';
        }
        this.state.addNotification('⚠️ 登録拒否: 単純なパスワードでの登録試行がブロックされました', true);
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        await this.api.registerUser({
          name: nameValue,
          id: newId,
          password: newPass,
          role: roleValue,
        });

        let roleLabel = '一般ユーザー';
        if (roleValue === 'master') roleLabel = 'マスターアカウント';
        if (roleValue === 'submaster') roleLabel = 'サブマスターアカウント';

        this.state.addNotification(
          `✨ 新規アカウント登録成功: [${roleLabel}] ${nameValue} 様 (ID: ${newId}) が登録されました`
        );

        alert('アカウントの登録が完了しました！ログイン画面へ移動します。');
        window.location.href = 'LoginTitle.html';
      } catch (err) {
        if (errorEl) errorEl.textContent = err.message || '登録に失敗しました';
        this.state.addNotification(`⚠️ 新規登録失敗: ${err.message || newId}`, true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const api = new AuthApi();
  const state = new AppState(api);
  const view = new RegisterView(api, state);
  view.init();
});