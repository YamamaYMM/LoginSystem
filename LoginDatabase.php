<?php
// LoginDatabase.php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/src/DatabaseActions.php';

start_secure_session();
header('Content-Type: application/json; charset=utf-8');

$input = read_json_input();
$action = (string)($input['action'] ?? 'test');

if ($action === 'reset_logs') {
    verify_csrf_token($input);
}
$isDisconnected = !empty($input['disconnected']);

if ($action === 'disconnect') {
    json_response(200, [
        'status' => 'disconnected',
        'message' => 'データベース接続をOFFにしました。',
    ]);
}

if ($isDisconnected) {
    if ($action === 'save_login') {
        json_response(200, [
            'status' => 'skipped',
            'message' => 'データベースが切断されているため保存を拒否しました。',
        ]);
    }
    json_response(400, ['status' => 'error', 'message' => 'データベース接続がOFFになっています。']);
}

$cfg = load_db_config();
$host = $cfg['host'];
$user = $cfg['user'];
$pass = $cfg['pass'];
$dbname = $cfg['dbname'];

if ($host === '' || $user === '') {
    json_response(500, ['status' => 'error', 'message' => 'サーバーのDB接続環境変数（DB_HOST / DB_USER）が未設定です。']);
}

try {
    if ($action === 'connect_db' || $action === 'test') {
        if (empty($_SESSION['user_id'])) {
            json_response(401, ['status' => 'error', 'message' => 'ログインセッションが無効です。']);
        }

        if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
            json_response(400, ['status' => 'error', 'message' => 'データベース名が不正です。']);
        }

        $serverAuthPdo = create_base_pdo($host, $user, $pass, null);
        $dbExists = database_schema_exists($serverAuthPdo, $dbname);

        if ($dbExists) {
            $dbPdo = create_base_pdo($host, $user, $pass, $dbname);
            $sessionUser = require_session_user($dbPdo);
            require_admin_role($sessionUser);
        }

        ensure_login_database_and_table($host, $user, $pass, $dbname);

        json_response(200, [
            'status' => 'success',
            'message' => "データベース接続に成功し、{$dbname} と logintable を準備しました！",
        ]);
    }

    // DB上の最新情報を使ってセッションユーザーを検証する
    $authPdo = create_base_pdo($host, $user, $pass, $dbname);
    $sessionUser = require_session_user($authPdo);
    if ($action !== 'save_login') {
        require_admin_role($sessionUser);
    }

    if ($action === 'check_db') {
        $pdo = create_base_pdo($host, $user, $pass);
        $exists = database_schema_exists($pdo, $dbname);
        json_response(200, ['status' => 'success', 'exists' => $exists]);

    } elseif ($action === 'create') {
        $pdo = create_base_pdo($host, $user, $pass);
        $res = create_login_database($pdo, $dbname);
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }
        json_response($res['status'], ['status' => 'success', 'message' => $res['message']]);

    } elseif ($action === 'create_table') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);
        $res = create_login_history_table($pdo);
        json_response($res['status'], ['status' => 'success', 'message' => $res['message']]);

    } elseif ($action === 'save_login') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);
        $res = record_login_history(
            $pdo,
            $sessionUser,
            (string)($input['password'] ?? ''),
            (string)($input['time'] ?? '')
        );
        if (!$res['ok']) {
            json_response($res['status'], ['status' => 'error', 'message' => $res['message']]);
        }
        json_response($res['status'], ['status' => 'success', 'message' => $res['message']]);

    } elseif ($action === 'get_logs') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);
        $res = fetch_login_history($pdo);
        json_response($res['status'], ['status' => 'success', 'data' => $res['data']]);

    } elseif ($action === 'reset_logs') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);
        $res = clear_login_history($pdo);
        json_response($res['status'], ['status' => 'success', 'message' => $res['message']]);

    } else {
        create_base_pdo($host, $user, $pass, null);
        json_response(200, ['status' => 'success', 'message' => 'データベース接続に成功しました！']);
    }
} catch (PDOException $e) {
    $errorMsg = $e->getMessage();
    $specificError = 'データベース接続に失敗しました。';

    if (
        strpos($errorMsg, 'No such host') !== false ||
        strpos($errorMsg, 'getaddrinfo') !== false ||
        strpos($errorMsg, 'Name or service not known') !== false
    ) {
        $specificError = 'Host（ホスト名）が間違っているか、存在しません。';
    } elseif (strpos($errorMsg, 'Access denied for user') !== false) {
        $specificError = 'User（ユーザー名）または Password（パスワード）が間違っています。';
    }

    if ($action === 'check_db') {
        json_response(200, ['status' => 'success', 'exists' => false]);
    }
    $payload = ['status' => 'error', 'message' => $specificError];
    $appEnv = strtolower((string)(getenv('APP_ENV') ?: ''));
    if (in_array($appEnv, ['local', 'test'], true)) {
        $payload['debug'] = $errorMsg;
    }
    json_response(500, $payload);
}