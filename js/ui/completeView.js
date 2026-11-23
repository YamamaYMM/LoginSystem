// js/ui/completeView.js
import { AppState, isConfidentialAttachment } from '../state/appState.js';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class CompleteView {
  constructor(state) {
    this.state = state;
    this.alertShowing = false;
    this.announcedToastIds = new Set();
    this.activeMessageTab = 'compose';
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

  async init() {
    if (!this.state.isLoggedIn() || !this.state.getCurrentUserName()) {
      const titleEl = document.getElementById('pageTitle');
      const errEl = document.getElementById('errorMessage');
      if (titleEl) titleEl.style.display = 'none';
      if (errEl) errEl.textContent = '不正アクセス検知';
      this.state.addNotification('⚠️ 不正アクセス検知: 未認証アクセスが発生しました', true);
      setTimeout(() => { window.location.href = 'LoginTitle.html'; }, 2000);
      return;
    }

    const mainContent = document.getElementById('mainContent');
    if (mainContent) mainContent.style.display = 'block';

    // サーバーセッションと最新のユーザー一覧を同期してからUI描画
    await this.state.syncSessionWithServer();

    const errorEl = document.getElementById('errorMessage');
    this.bindGlobalEvents();
    this.bindPasswordModal(errorEl);
    this.bindMessageModal();
    this.bindTopRightNotifications();

    this.state.updateHeartbeat();
    await this.refresh(true);

    setInterval(async () => {
      this.state.updateHeartbeat();
      await this.state.refreshUsersFromServer();
      await this.refresh(false);
    }, 2000);
  }

  async refresh(triggerToastForNew = false) {
    await this.handleForcedLogoutIfNeeded();
    this.renderDashboard();
    this.updateMessageBadge(triggerToastForNew);
  }

  async handleForcedLogoutIfNeeded() {
    if (this.alertShowing) return;
    if (!this.state.consumeForcedLogoutSignal()) return;

    this.alertShowing = true;
    await this.showCustomAlert('管理者によってログアウトされました。');
    this.state.clearSession();
    window.location.replace('LoginTitle.html');
  }

  showCustomAlert(text) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;';

      const dialog = document.createElement('div');
      dialog.style.cssText =
        'background:#fff;padding:24px;border-radius:8px;max-width:360px;width:100%;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.3);';

      const message = document.createElement('p');
      message.textContent = text;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'OK';
      button.style.cssText = 'padding:6px 24px;cursor:pointer;';
      button.addEventListener('click', () => {
        overlay.remove();
        resolve();
      }, { once: true });

      dialog.append(message, button);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      button.focus();
    });
  }

  renderDashboard() {
    const userName = this.state.getCurrentUserName();
    const me = this.state.getCurrentUser();
    const hasAdminAccess = Boolean(
      me && (me.role === 'master' || me.role === 'submaster' || me.isManager === true)
    );
    const welcomeEl = document.getElementById('welcomeMessage');

    if (userName === 'ゲスト') {
      if (welcomeEl) welcomeEl.textContent = 'ようこそ、ゲストさん！';
      ['deleteAccountButton', 'openPasswordModalBtn', 'openMessageModalBtn', 'topRightMsgNotifArea']
        .forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      return;
    }

    if (!me) return;

    if (welcomeEl) welcomeEl.textContent = `ようこそ、${me.name} さん！`;
    const notifArea = document.getElementById('topRightMsgNotifArea');
    if (notifArea) notifArea.style.display = 'flex';

    const goToManagerBtn = document.getElementById('goToManagerBtn');
    const tableContainer = document.getElementById('adminUserTableContainer');

    if (!hasAdminAccess) {
      if (goToManagerBtn) goToManagerBtn.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    }

    if (goToManagerBtn) {
      goToManagerBtn.style.display = 'inline-block';
      goToManagerBtn.onclick = () => { window.location.href = 'LoginManager.html'; };
    }
    if (tableContainer) tableContainer.style.display = 'block';

    this.renderUserTable(me);
  }

  renderUserTable(actor) {
    const tableBody = document.getElementById('userTableBody');
    if (!tableBody) return;

    const users = this.state.getUsers();
    if (users.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6">登録されているアカウントはありません。</td></tr>';
      return;
    }

    tableBody.innerHTML = users.map(user => {
      let roleText = '👤 一般ユーザー';
      let roleBtn = '';

      if (user.role === 'master') roleText = '👑 マスター';
      else if (user.role === 'submaster') roleText = '⭐ サブマスター';
      else if (user.isManager) {
        roleText = '🔧 一般 (管理権限あり)';
        if (actor.role === 'master' || actor.role === 'submaster') {
          roleBtn = `<button class="toggle-role-btn" style="background-color:#ffcccc;" data-id="${escapeHtml(user.id)}">権限を剥奪</button>`;
        }
      } else if (actor.role === 'master' || actor.role === 'submaster') {
        roleBtn = `<button class="toggle-role-btn" style="background-color:#d4edda;" data-id="${escapeHtml(user.id)}">管理権限を付与</button>`;
      }

      const canDelete = (actor.role === 'master' || actor.role === 'submaster') &&
        user.id !== actor.id &&
        !(actor.role === 'submaster' && user.role === 'master');
      const deleteBtn = canDelete
        ? `<button class="delete-btn delete-user-btn" data-id="${escapeHtml(user.id)}">削除</button>`
        : '';

      const canLogout = this.state.canForceLogout(actor, user);
      const online = this.state.isUserOnline(user.id);
      const logoutBtn = canLogout
        ? `<button class="force-logout-btn" data-id="${escapeHtml(user.id)}" ${online ? '' : 'disabled title="ログインしていません"'}>ログアウト</button>`
        : '';

      return `
        <tr>
          <td>${escapeHtml(user.name)}</td>
          <td>${escapeHtml(user.id)}</td>
          <td>${roleText}</td>
          <td>${roleBtn}</td>
          <td>${deleteBtn}</td>
          <td>${logoutBtn}</td>
        </tr>
      `;
    }).join('');
  }

  bindGlobalEvents() {
    const tableBody = document.getElementById('userTableBody');
    if (tableBody) {
      tableBody.addEventListener('click', async e => {
        const targetBtn = e.target.closest('button');
        if (!targetBtn) return;
        const targetId = targetBtn.dataset.id;

        try {
          if (targetBtn.classList.contains('toggle-role-btn')) {
            const updated = await this.state.toggleManagerRoleAsync(targetId);
            if (updated) {
              alert(`${updated.name} さんに${updated.isManager ? '管理権限の付与' : '管理権限の剥奪'}しました。`);
              this.renderDashboard();
            }
          } else if (targetBtn.classList.contains('delete-user-btn')) {
            const target = this.state.getUsers().find(u => u.id === targetId);
            if (target && confirm(`本当にアカウント「${target.name}」を削除しますか？\nこの操作は取り消せません。`)) {
              await this.state.deleteUserAsync(targetId);
              alert(`アカウント「${target.name}」を削除しました。`);
              this.renderDashboard();
            }
          } else if (targetBtn.classList.contains('force-logout-btn')) {
            const target = this.state.getUsers().find(u => u.id === targetId);
            if (target && confirm(`「${target.name}」を強制ログアウトさせますか？`)) {
              const requested = await this.state.requestForcedLogoutAsync(targetId);
              if (requested) {
                alert(`${requested.name} さんにログアウトを要求しました。`);
                this.renderDashboard();
              }
            }
          }
        } catch (err) {
          alert(err.message || '操作に失敗しました。');
        }
      });
    }

    document.getElementById('logoutButton')?.addEventListener('click', async () => {
      await this.state.clearSessionAsync();
      alert('ログアウトしました');
      window.location.href = 'LoginTitle.html';
    });

    document.getElementById('deleteAccountButton')?.addEventListener('click', async () => {
      const me = this.state.getCurrentUser();
      if (!me) return;

      if (!confirm(`本当にアカウント「${me.name}」を削除しますか？\nこの操作は取り消せません。`)) {
        return;
      }

      try {
        await this.state.deleteSelfAsync();
        localStorage.removeItem('dbConfig');
        alert('アカウントを削除しました。ログイン画面へ戻ります。');
        window.location.href = 'LoginTitle.html';
      } catch (err) {
        alert(err.message || 'アカウントの削除に失敗しました。');
      }
    });

    const messageModal = document.getElementById('messageModal');
    const passwordModal = document.getElementById('passwordModal');
    window.addEventListener('click', event => {
      if (event.target === messageModal && messageModal) messageModal.style.display = 'none';
      if (event.target === passwordModal && passwordModal) passwordModal.style.display = 'none';
    });

    window.addEventListener('storage', event => {
      if (event.key === 'user_messages') {
        this.updateMessageBadge(true);
        if (messageModal && messageModal.style.display === 'block') {
          if (this.activeMessageTab === 'inbox') this.renderInbox();
          else if (this.activeMessageTab === 'sent') this.renderSent();
        }
        return;
      }

      if (event.key && event.key.startsWith('forcedLogout:') && event.newValue !== null) {
        this.handleForcedLogoutIfNeeded();
      }
    });
  }

  bindPasswordModal(errorEl = null) {
    const modal = document.getElementById('passwordModal');
    const errEl = document.getElementById('modalErrorMsg') || errorEl;
    const toggleCheckbox = document.getElementById('toggleModalPassword');
    const currentInput = document.getElementById('currentPassInput');
    const newInput = document.getElementById('newPassInput');
    const confirmInput = document.getElementById('confirmNewPassInput');
    const submitBtn = document.getElementById('submitPasswordChange');

    [currentInput, newInput, confirmInput].forEach(input => {
      this.preventFullWidthInput(input, errEl);
    });

    const applyPasswordVisibility = checked => {
      const type = checked ? 'text' : 'password';
      [currentInput, newInput, confirmInput].forEach(input => {
        if (!input) return;
        input.type = type;
        input.setAttribute('inputmode', 'latin');
        input.setAttribute('lang', 'en');
        input.setAttribute('spellcheck', 'false');
        input.style.imeMode = 'disabled';
        this.enforceAsciiOnly(input, errEl);
      });
    };

    toggleCheckbox?.addEventListener('change', () => {
      applyPasswordVisibility(toggleCheckbox.checked);
    });

    document.getElementById('openPasswordModalBtn')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'block';
      if (currentInput) currentInput.value = '';
      if (newInput) newInput.value = '';
      if (confirmInput) confirmInput.value = '';
      if (toggleCheckbox) toggleCheckbox.checked = false;
      applyPasswordVisibility(false);
      if (errEl) errEl.textContent = '';
    });

    document.getElementById('closePasswordModal')?.addEventListener('click', () => {
      if (modal) modal.style.display = 'none';
    });

    submitBtn?.addEventListener('click', async () => {
      const currentPass = currentInput ? currentInput.value : '';
      const newPass = newInput ? newInput.value.trim() : '';
      const confirmPass = confirmInput ? confirmInput.value.trim() : '';
      if (errEl) errEl.textContent = '';

      if (!/^[\x21-\x7E]+$/.test(newPass) || !/^[\x21-\x7E]+$/.test(confirmPass)) {
        if (errEl) {
          errEl.textContent = 'パスワードは半角英数字・記号で入力してください';
        }
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        const result = await this.state.changePasswordAsync(currentPass, newPass, confirmPass);
        if (!result.ok) {
          if (errEl) errEl.textContent = result.error;
          return;
        }

        alert('パスワードの変更が完了しました。');
        if (modal) modal.style.display = 'none';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  bindTopRightNotifications() {
    const bellBtn = document.getElementById('msgNotifBellBtn');
    const dropdown = document.getElementById('msgNotifDropdown');
    const markAllBtn = document.getElementById('markAllMsgReadBtn');

    if (bellBtn && dropdown) {
      bellBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === 'block';
        dropdown.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) this.renderTopRightNotifDropdown();
      });
      dropdown.addEventListener('click', e => e.stopPropagation());
      document.addEventListener('click', () => { dropdown.style.display = 'none'; });
    }

    markAllBtn?.addEventListener('click', () => {
      if (this.state.markInboxAsRead()) {
        this.updateMessageBadge(false);
      }
    });
  }

  showMessageToast(msg) {
    if (!msg || this.announcedToastIds.has(msg.id)) return;
    this.announcedToastIds.add(msg.id);

    const container = document.getElementById('msgToastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'msg-toast';
    toast.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 3px; color: #38bdf8;">✉️ 新着メッセージ</div>
      <div style="font-size: 0.85em; color: #cbd5e1;">差出人: ${escapeHtml(msg.fromName)} (${escapeHtml(msg.fromId)})</div>
      <div style="margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">件名: ${escapeHtml(msg.subject)}</div>
    `;

    toast.addEventListener('click', () => {
      toast.remove();
      const messageModal = document.getElementById('messageModal');
      if (messageModal) messageModal.style.display = 'block';
      this.switchMessageTab('inbox');
    });

    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, 5000);
  }

  renderTopRightNotifDropdown() {
    const listEl = document.getElementById('msgNotifDropdownList');
    if (!listEl) return;

    const recent = this.state.getInboxMessages().slice(0, 15);
    if (recent.length === 0) {
      listEl.innerHTML = '<p style="text-align: center; color: #777; font-size: 0.85em; margin: 12px 0;">新着メッセージはありません。</p>';
      return;
    }

    listEl.innerHTML = '';
    recent.forEach(msg => {
      const item = document.createElement('div');
      item.className = `msg-notif-item ${msg.read ? '' : 'unread'}`;
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; font-size: 0.8em; color: #666;">
          <span><strong>${escapeHtml(msg.fromName)}</strong></span>
          <span>${escapeHtml(msg.timeStr)}</span>
        </div>
        <div style="font-weight: bold; margin-top: 2px; color: #222;">${escapeHtml(msg.subject)}</div>
        <div style="color: #555; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(msg.body)}</div>
      `;
      item.addEventListener('click', () => {
        const dropdown = document.getElementById('msgNotifDropdown');
        const messageModal = document.getElementById('messageModal');
        if (dropdown) dropdown.style.display = 'none';
        if (messageModal) messageModal.style.display = 'block';
        this.switchMessageTab('inbox');
      });
      listEl.appendChild(item);
    });
  }

  updateMessageBadge(triggerToastForNew = false) {
    const me = this.state.getCurrentUser();
    if (!me) return;

    const unreadMessages = this.state.getUnreadMessagesForCurrentUser();
    const unreadCount = unreadMessages.length;

    const openBtn = document.getElementById('openMessageModalBtn');
    const tabInboxBtn = document.getElementById('tabInboxBtn');
    const topBadge = document.getElementById('msgNotifBadge');

    if (openBtn) openBtn.textContent = unreadCount > 0 ? `メッセージ (${unreadCount})` : 'メッセージ';
    if (tabInboxBtn) tabInboxBtn.textContent = unreadCount > 0 ? `受信トレイ (${unreadCount})` : '受信トレイ';
    if (topBadge) {
      if (unreadCount > 0) {
        topBadge.textContent = unreadCount;
        topBadge.style.display = 'inline-block';
      } else {
        topBadge.style.display = 'none';
      }
    }

    this.renderTopRightNotifDropdown();

    if (triggerToastForNew && unreadCount > 0) {
      this.showMessageToast(unreadMessages[0]);
    }
  }

  bindMessageModal() {
    const messageModal = document.getElementById('messageModal');
    const openBtn = document.getElementById('openMessageModalBtn');
    const statusEl = document.getElementById('messageStatusMsg');
    const fileUploadBtn = document.getElementById('fileUploadBtn');
    const fileInput = document.getElementById('messageFileInput');
    const fileNameEl = document.getElementById('messageFileName');
    const sendBtn = document.getElementById('sendMessageBtn');
    const clearBtn = document.getElementById('clearMessageBtn');

    document.getElementById('tabComposeBtn')?.addEventListener('click', () => this.switchMessageTab('compose'));
    document.getElementById('tabInboxBtn')?.addEventListener('click', () => this.switchMessageTab('inbox'));
    document.getElementById('tabSentBtn')?.addEventListener('click', () => this.switchMessageTab('sent'));

    openBtn?.addEventListener('click', () => {
      if (messageModal) messageModal.style.display = 'block';
      if (statusEl) statusEl.textContent = '';
      this.populateRecipientOptions();
      const hasUnread = this.state.getUnreadMessagesForCurrentUser().length > 0;
      this.switchMessageTab(hasUnread ? 'inbox' : 'compose');
    });

    ['closeMessageModal', 'closeMessageModalInbox', 'closeMessageModalSent'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => {
        if (messageModal) messageModal.style.display = 'none';
      });
    });

    if (fileUploadBtn && fileInput) {
      fileUploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (file && isConfidentialAttachment(file)) {
          if (statusEl) {
            statusEl.style.color = 'red';
            statusEl.textContent = '機密ファイルは添付できません。';
          }
          fileInput.value = '';
          if (fileNameEl) fileNameEl.textContent = '';
          return;
        }
        if (file && file.size > 1024 * 1024) {
          if (statusEl) {
            statusEl.style.color = 'red';
            statusEl.textContent = '添付ファイルは1MB以下にしてください。';
          }
          fileInput.value = '';
          if (fileNameEl) fileNameEl.textContent = '';
          return;
        }
        if (fileNameEl) fileNameEl.textContent = file ? `選択中: ${file.name}` : '';
        if (statusEl) statusEl.textContent = '';
      });
    }

    clearBtn?.addEventListener('click', () => {
      const toInput = document.getElementById('toInput');
      const subjectInput = document.getElementById('subjectInput');
      const bodyInput = document.getElementById('bodyInput');
      if (toInput) toInput.value = '';
      if (subjectInput) subjectInput.value = '';
      if (bodyInput) bodyInput.value = '';
      if (fileInput) fileInput.value = '';
      if (fileNameEl) fileNameEl.textContent = '';
      if (statusEl) statusEl.textContent = '';
    });

    sendBtn?.addEventListener('click', async () => {
      const toInput = document.getElementById('toInput');
      const subjectInput = document.getElementById('subjectInput');
      const bodyInput = document.getElementById('bodyInput');

      const toVal = toInput ? toInput.value.trim() : '';
      const subjectVal = subjectInput ? subjectInput.value.trim() : '';
      const bodyVal = bodyInput ? bodyInput.value.trim() : '';
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;

      if (statusEl) {
        statusEl.style.color = 'red';
        statusEl.textContent = '';
      }

      sendBtn.disabled = true;
      try {
        const res = await this.state.sendMessage({ toVal, subjectVal, bodyVal, file });
        if (!res.ok) {
          if (res.clearFile && fileInput) {
            fileInput.value = '';
            if (fileNameEl) fileNameEl.textContent = '';
          }
          if (statusEl) statusEl.textContent = res.error;
          return;
        }

        if (toInput) toInput.value = '';
        if (subjectInput) subjectInput.value = '';
        if (bodyInput) bodyInput.value = '';
        if (fileInput) fileInput.value = '';
        if (fileNameEl) fileNameEl.textContent = '';

        if (statusEl) {
          statusEl.style.color = 'green';
          statusEl.textContent = `${res.recipient.name} (${res.recipient.id}) さんへ送信しました！`;
        }
        this.updateMessageBadge(false);
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err.message || 'ファイルを含むメッセージを保存できませんでした。';
        }
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  switchMessageTab(tabName) {
    this.activeMessageTab = tabName;
    const composeView = document.getElementById('composeView');
    const inboxView = document.getElementById('inboxView');
    const sentView = document.getElementById('sentView');
    const tabComposeBtn = document.getElementById('tabComposeBtn');
    const tabInboxBtn = document.getElementById('tabInboxBtn');
    const tabSentBtn = document.getElementById('tabSentBtn');

    if (composeView) composeView.style.display = tabName === 'compose' ? 'block' : 'none';
    if (inboxView) inboxView.style.display = tabName === 'inbox' ? 'block' : 'none';
    if (sentView) sentView.style.display = tabName === 'sent' ? 'block' : 'none';

    tabComposeBtn?.classList.toggle('active', tabName === 'compose');
    tabInboxBtn?.classList.toggle('active', tabName === 'inbox');
    tabSentBtn?.classList.toggle('active', tabName === 'sent');

    if (tabName === 'compose') this.populateRecipientOptions();
    else if (tabName === 'inbox') this.renderInbox();
    else this.renderSent();
  }

  populateRecipientOptions() {
    const datalist = document.getElementById('recipientOptions');
    if (!datalist) return;
    const me = this.state.getCurrentUser();
    datalist.innerHTML = '';

    this.state.getUsers().forEach(user => {
      if (me && user.id === me.id) return;
      const option = document.createElement('option');
      option.value = user.id;
      option.label = `${user.name} (${user.id})`;
      datalist.appendChild(option);
    });
  }

  renderInbox() {
    const inboxList = document.getElementById('inboxList');
    if (!inboxList) return;

    const myMessages = this.state.getInboxMessages();
    if (myMessages.length === 0) {
      inboxList.innerHTML = '<p style="text-align: center; color: #777; font-size: 0.9em; margin: 20px 0;">受信したメッセージはありません。</p>';
      return;
    }

    inboxList.innerHTML = '';
    myMessages.forEach(msg => {
      const item = document.createElement('div');
      item.className = `inbox-item ${msg.read ? '' : 'unread'}`;
      item.innerHTML = `
        <div class="inbox-item-header">
          <span>差出人: <strong>${escapeHtml(msg.fromName)}</strong> (${escapeHtml(msg.fromId)})</span>
          <span>${escapeHtml(msg.timeStr)}</span>
        </div>
        <div class="inbox-item-subject">${escapeHtml(msg.subject)}</div>
        <div class="inbox-item-body">${escapeHtml(msg.body)}</div>
        ${msg.attachment ? `<div style="margin-top: 6px;">添付ファイル: <a href="${escapeHtml(msg.attachment.data)}" download="${escapeHtml(msg.attachment.name)}">${escapeHtml(msg.attachment.name)}</a></div>` : ''}
        <div style="text-align: right;">
          <button type="button" class="reply-msg-btn" data-sender-id="${escapeHtml(msg.fromId)}" style="padding: 3px 8px; font-size: 0.8em; cursor: pointer; background-color: #17a2b8; color: white; border: none; border-radius: 3px;">返信</button>
          <button type="button" class="delete-msg-btn" data-msg-id="${escapeHtml(msg.id)}" style="padding: 3px 8px; font-size: 0.8em; cursor: pointer; background-color: #ff4d4d; color: white; border: none; border-radius: 3px; margin-left: 4px;">削除</button>
        </div>
      `;
      inboxList.appendChild(item);
    });

    if (this.state.markInboxAsRead()) {
      this.updateMessageBadge(false);
    }

    inboxList.querySelectorAll('.reply-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const senderId = btn.getAttribute('data-sender-id');
        this.switchMessageTab('compose');
        const toInput = document.getElementById('toInput');
        const subjectInput = document.getElementById('subjectInput');
        if (toInput) toInput.value = senderId;
        if (subjectInput) subjectInput.focus();
      });
    });

    inboxList.querySelectorAll('.delete-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = btn.getAttribute('data-msg-id');
        this.state.deleteMessage(msgId);
        this.renderInbox();
        this.updateMessageBadge(false);
      });
    });
  }

  renderSent() {
    const sentList = document.getElementById('sentList');
    if (!sentList) return;

    const myMessages = this.state.getSentMessages();
    if (myMessages.length === 0) {
      sentList.innerHTML = '<p style="text-align: center; color: #777; font-size: 0.9em; margin: 20px 0;">送信済みメッセージはありません。</p>';
      return;
    }

    sentList.innerHTML = '';
    myMessages.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'inbox-item';
      item.innerHTML = `
        <div class="inbox-item-header">
          <span>宛先: <strong>${escapeHtml(msg.toName)}</strong> (${escapeHtml(msg.toId)})</span>
          <span>${escapeHtml(msg.timeStr)}</span>
        </div>
        <div class="inbox-item-subject">${escapeHtml(msg.subject)}</div>
        <div class="inbox-item-body">${escapeHtml(msg.body)}</div>
        ${msg.attachment ? `<div style="margin-top: 6px;">添付ファイル: <a href="${escapeHtml(msg.attachment.data)}" download="${escapeHtml(msg.attachment.name)}">${escapeHtml(msg.attachment.name)}</a></div>` : ''}
        <div style="text-align: right;">
          <button type="button" class="delete-sent-msg-btn" data-msg-id="${escapeHtml(msg.id)}" style="padding: 3px 8px; font-size: 0.8em; cursor: pointer; background-color: #ff4d4d; color: white; border: none; border-radius: 3px;">削除</button>
        </div>
      `;
      sentList.appendChild(item);
    });

    sentList.querySelectorAll('.delete-sent-msg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const msgId = btn.getAttribute('data-msg-id');
        this.state.deleteMessage(msgId);
        this.renderSent();
        this.updateMessageBadge(false);
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const state = new AppState();
  const view = new CompleteView(state);
  view.init();
});