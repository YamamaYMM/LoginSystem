// js/api/authApi.js
export class AuthApi {
  constructor(options = {}) {
    if (typeof options === 'string') {
      options = { baseUrl: options };
    }

    const {
      dbEndpoint = 'LoginDatabase.php',
      authEndpoint = 'auth_api.php',
      baseUrl = '',
    } = options;

    this.dbEndpoint = dbEndpoint;
    this.authEndpoint = authEndpoint;
    this.baseUrl = baseUrl;
    this.csrfToken = '';

    try {
      this.csrfToken = sessionStorage.getItem('csrfToken') || '';
    } catch {
      this.csrfToken = '';
    }
  }

  setCsrfToken(token) {
    if (typeof token === 'string' && token.length > 0) {
      this.csrfToken = token;
      try {
        sessionStorage.setItem('csrfToken', token);
      } catch {
        // Session storage may be unavailable; keep the token in memory.
      }
    }
  }

  clearCsrfToken() {
    this.csrfToken = '';
    try {
      sessionStorage.removeItem('csrfToken');
    } catch {
      // Session storage may be unavailable.
    }
  }

  async ensureCsrfToken() {
    if (this.csrfToken) {
      return this.csrfToken;
    }

    await this.postJson(this.authEndpoint, { action: 'session_status' }, { includeCsrf: false });
    return this.csrfToken;
  }

  async postJson(url, payload, { includeCsrf = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const bodyPayload = { ...payload };

    if (includeCsrf) {
      const token = await this.ensureCsrfToken();
      if (token) {
        headers['X-CSRF-Token'] = token;
        bodyPayload.csrf_token = token;
      }
    }

    const endpoint = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(bodyPayload),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (data && typeof data.csrfToken === 'string') {
      this.setCsrfToken(data.csrfToken);
    }

    if (!response.ok) {
      const message = (data && data.message) || `HTTP error: ${response.status}`;
      const err = new Error(message);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  saveLogin({ name, id, password, time } = {}, { disconnected = false } = {}) {
    return this.postJson(
      this.dbEndpoint,
      {
        action: 'save_login',
        disconnected,
        name,
        id,
        password,
        time,
      },
      { includeCsrf: true }
    );
  }

  callDatabaseAction(action, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const csrfActions = new Set(['connect_db', 'create', 'create_table', 'save_login', 'reset_logs']);
    const { disconnected = false, includeCsrf = csrfActions.has(action) } = opts;
    return this.postJson(this.dbEndpoint, {
      action,
      disconnected,
    }, { includeCsrf });
  }

  connectAndInitDatabase(options) {
    return this.callDatabaseAction('connect_db', options);
  }

  testDbConnection(options) {
    return this.callDatabaseAction('test', options);
  }

  checkDatabaseExistence(options) {
    return this.callDatabaseAction('check_db', options);
  }

  createDatabase(options) {
    return this.callDatabaseAction('create', options);
  }

  createLoginTable(options) {
    return this.callDatabaseAction('create_table', options);
  }

  getLoginLogs(options) {
    return this.callDatabaseAction('get_logs', options);
  }

  resetLoginLogs(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    return this.callDatabaseAction('reset_logs', { ...opts, includeCsrf: true });
  }

  registerUser({ name, id, password, role, dbConfig = null }) {
    const payload = {
      action: 'register_user',
      name,
      id,
      password,
      role,
    };
    if (dbConfig) {
      payload.dbConfig = dbConfig;
    }
    return this.postJson(this.authEndpoint, payload);
  }

  loginSession({ name, id, password }) {
    return this.postJson(this.authEndpoint, {
      action: 'login_session',
      name,
      id,
      password,
    }, { includeCsrf: false });
  }

  async logoutSession() {
    const data = await this.postJson(this.authEndpoint, { action: 'logout_session' });
    this.clearCsrfToken();
    return data;
  }

  getSessionStatus() {
    return this.postJson(this.authEndpoint, { action: 'session_status' }, { includeCsrf: false });
  }

  listUsers() {
    return this.postJson(this.authEndpoint, { action: 'list_users' });
  }

  changePassword(currentPassword, newPassword) {
    return this.postJson(this.authEndpoint, {
      action: 'change_password',
      currentPassword,
      newPassword,
    });
  }

  toggleManagerRole(targetId) {
    return this.postJson(this.authEndpoint, {
      action: 'toggle_manager_role',
      targetId,
    });
  }

  deleteUser(targetId) {
    return this.postJson(this.authEndpoint, {
      action: 'delete_user',
      targetId,
    });
  }

  deleteSelf() {
    return this.postJson(this.authEndpoint, {
      action: 'delete_self',
    });
  }

  authorizeForceLogout(targetId) {
    return this.postJson(this.authEndpoint, {
      action: 'authorize_force_logout',
      targetId,
    });
  }

  resetPassword({ name, id, newPassword }) {
    return this.postJson(this.authEndpoint, {
      action: 'reset_password',
      name,
      id,
      newPassword,
    });
  }
}