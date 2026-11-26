<?php
// auth_api.php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/src/AuthActions.php';

$csrfToken = start_secure_session();
header('Content-Type: application/json; charset=utf-8');

$input = read_json_input();
$action = (string)($input['action'] ?? '');

// 状態変更を伴うアクションには CSRF 検証を適用
$mutatingActions = [
    'register_user',
    'logout_session',
    'reset_password',
    'delete_self',
    'change_password',
    'toggle_manager_role',
    'delete_user',
    'authorize_force_logout',
];
if (in_array($action, $mutatingActions, true)) {
    verify_csrf_token($input);
}

try {
    $skipInitialDbCheck = in_array($action, ['register_user', 'session_status', 'logout_session'], true);
    $pdo = $skipInitialDbCheck ? null : get_pdo(true);

    // 1. 新規アカウント登録
    if ($action === 'register_user') {
        $role = (string)($input['role'] ?? 'general');

        if ($role === 'master') {
            $serverCfg = load_db_config();
            $host = $serverCfg['host'];
            $dbUser = $serverCfg['user'];
            $dbPass = $serverCfg['pass'];

            if ($host === '' || $dbUser === '') {
                json_response(400, [
                    'status' => 'error',
                    'message' => 'DB接続設定（Host / User）がサーバー側に構成されていません。',
                ]);
            }
            $pdo = init_db_and_tables_from_credentials($host, $dbUser, $dbPass, $serverCfg['dbname']);
        } else {
            $pdo = get_pdo(true);
        }

        $res = register_user_account($pdo, $input);
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        json_response($res['status'], [
            'status' => 'success',
            'message' => $res['message'],
            'user' => $res['user'],
        ]);
    }

    // 2. ログイン認証
    if ($action === 'login_session') {
        $pdo ??= get_pdo(true);
        $res = verify_login_credentials(
            $pdo,
            (string)($input['name'] ?? ''),
            (string)($input['id'] ?? ''),
            (string)($input['password'] ?? '')
        );
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        $user = $res['user'];
        session_regenerate_id(true);
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        $csrfToken = $_SESSION['csrf_token'];
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['user_name'] = $user['name'];
        $_SESSION['role'] = $user['role'];
        $_SESSION['is_manager'] = $user['isManager'];

        json_response($res['status'], [
            'status' => 'success',
            'csrfToken' => $_SESSION['csrf_token'],
            'user' => $user,
        ]);
    }

    // 3. ログアウト
    if ($action === 'logout_session') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                (bool)$params['secure'],
                (bool)$params['httponly']
            );
        }
        session_destroy();
        json_response(200, ['status' => 'success']);
    }

    // 4. セッション状態確認
    if ($action === 'session_status') {
        $appEnv = app_env_name();

        if (empty($_SESSION['user_id'])) {
            json_response(200, [
                'status' => 'success',
                'authenticated' => false,
                'user' => null,
                'csrfToken' => $csrfToken,
                'appEnv' => $appEnv,
            ]);
        }

        $pdo = get_pdo(true);
        $stmt = $pdo->prepare("SELECT id, name, role, is_manager FROM users WHERE id = ? LIMIT 1");
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch();
        if (!$user) {
            $_SESSION = [];
            session_destroy();
            json_response(200, [
                'status' => 'success',
                'authenticated' => false,
                'user' => null,
                'csrfToken' => $csrfToken,
                'appEnv' => $appEnv,
            ]);
        }

        json_response(200, [
            'status' => 'success',
            'authenticated' => true,
            'csrfToken' => $csrfToken,
            'appEnv' => $appEnv,
            'user' => [
                'id' => $user['id'],
                'name' => $user['name'],
                'role' => $user['role'],
                'isManager' => (bool)$user['is_manager'],
            ],
        ]);
    }

    // パスワード再設定
    if ($action === 'reset_password') {
        $pdo ??= get_pdo(true);
        $res = reset_user_password(
            $pdo,
            (string)($input['name'] ?? ''),
            (string)($input['id'] ?? ''),
            (string)($input['newPassword'] ?? '')
        );
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        json_response($res['status'], ['status' => 'success', 'message' => $res['message']]);
    }

    // --- 以降はログイン必須 ---
    $pdo ??= get_pdo(true);
    $actor = require_session_user($pdo);

    if ($action === 'delete_self') {
        $del = $pdo->prepare("DELETE FROM users WHERE id = ?");
        $del->execute([$actor['id']]);
        $databaseDropped = is_production_env()
            ? false
            : drop_database_if_users_empty($pdo, get_configured_dbname());

        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                (bool)$params['secure'],
                (bool)$params['httponly']
            );
        }
        session_destroy();

        json_response(200, [
            'status' => 'success',
            'databaseDropped' => $databaseDropped,
            'message' => 'アカウントを削除しました。',
        ]);
    }

    if ($action === 'list_users') {
        json_response(200, [
            'status' => 'success',
            'users' => fetch_safe_users($pdo),
        ]);
    }

    if ($action === 'change_password') {
        $res = change_user_password(
            $pdo,
            (string)$actor['id'],
            (string)($input['currentPassword'] ?? ''),
            (string)($input['newPassword'] ?? '')
        );
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        json_response($res['status'], ['status' => 'success', 'message' => $res['message']]);
    }

    if ($action === 'toggle_manager_role') {
        require_admin_role($actor);

        $res = toggle_general_manager_role($pdo, (string)($input['targetId'] ?? ''));
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        json_response($res['status'], [
            'status' => 'success',
            'target' => $res['target'],
            'users' => $res['users'],
        ]);
    }

    if ($action === 'delete_user') {
        require_admin_role($actor);

        $res = delete_managed_user($pdo, $actor, (string)($input['targetId'] ?? ''), get_configured_dbname());
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        json_response($res['status'], [
            'status' => 'success',
            'deleted' => $res['deleted'],
            'databaseDropped' => $res['databaseDropped'],
            'users' => $res['users'],
        ]);
    }

    if ($action === 'authorize_force_logout') {
        require_admin_role($actor);

        $res = authorize_force_logout_target($pdo, $actor, (string)($input['targetId'] ?? ''));
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }

        json_response($res['status'], [
            'status' => 'success',
            'targetId' => $res['targetId'],
            'targetName' => $res['targetName'],
        ]);
    }

    json_response(400, ['status' => 'error', 'message' => '未対応のアクションです。']);
} catch (Throwable $e) {
    error_log('[ERROR] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    $showDetail = function_exists('is_debug_env')
        ? is_debug_env()
        : in_array(app_env_name(), ['local', 'test', 'development'], true);
    json_response(500, [
        'status' => 'error',
        'message' => $showDetail
            ? 'サーバーエラーが発生しました: ' . $e->getMessage()
            : 'サーバー内部でエラーが発生しました。',
    ]);
}