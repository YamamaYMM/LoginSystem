<?php
declare(strict_types=1);

function db_handler_is_production(): bool
{
    if (function_exists('is_production_env')) {
        return is_production_env();
    }

    $raw = getenv('APP_ENV');
    if ($raw === false || trim((string)$raw) === '') {
        $raw = $_ENV['APP_ENV'] ?? $_SERVER['APP_ENV'] ?? 'production';
    }

    return in_array(strtolower(trim((string)$raw)), ['production', 'prod'], true);
}

function db_handler_is_debug_enabled(): bool
{
    if (function_exists('is_debug_env_enabled')) {
        return is_debug_env_enabled();
    }

    $raw = getenv('APP_ENV');
    if ($raw === false || trim((string)$raw) === '') {
        $raw = $_ENV['APP_ENV'] ?? $_SERVER['APP_ENV'] ?? 'production';
    }

    return in_array(strtolower(trim((string)$raw)), ['local', 'test'], true);
}

function db_handler_json_error(int $statusCode, string $message, array $extra = []): never
{
    if (function_exists('json_error')) {
        json_error($statusCode, $message, $extra);
    }

    json_response($statusCode, array_merge([
        'status' => 'error',
        'message' => $message,
    ], $extra));
}

function db_handler_guard_non_production(string $action, string $label): void
{
    if (db_handler_is_production()) {
        db_handler_json_error(403, "本番環境では「{$label}（{$action}）」を実行できません。");
    }
}

function db_handler_require_admin(array $sessionUser): void
{
    if (function_exists('require_admin_role')) {
        require_admin_role($sessionUser);
        return;
    }

    $role = strtolower(trim((string)($sessionUser['role'] ?? $_SESSION['role'] ?? $_SESSION['user_role'] ?? '')));
    if (!in_array($role, ['master', 'submaster', 'admin'], true)) {
        db_handler_json_error(403, '管理者権限が必要です。');
    }
}

function guard_db_request(string $action, bool $isDisconnected, array $cfg): void
{
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
        db_handler_json_error(400, 'データベース接続がOFFになっています。');
    }

    if ($cfg['host'] === '' || $cfg['user'] === '') {
        db_handler_json_error(500, 'サーバーのDB接続環境変数（DB_HOST / DB_USER）が未設定です。');
    }
}

function handle_db_connect_action(array $cfg): void
{
    $dbname = (string)($cfg['dbname'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        db_handler_json_error(400, 'データベース名が不正です。');
    }

    if (empty($_SESSION['user_id'])) {
        db_handler_json_error(401, 'ログインセッションが無効です。');
    }

    $serverAuthPdo = create_base_pdo($cfg['host'], $cfg['user'], $cfg['pass'], null);
    $hasSchema = function_exists('database_schema_exists')
        ? (bool)database_schema_exists($serverAuthPdo, $dbname)
        : false;

    if ($hasSchema && function_exists('require_session_user')) {
        $dbPdo = create_base_pdo($cfg['host'], $cfg['user'], $cfg['pass'], $dbname);
        $sessionUser = require_session_user($dbPdo);
        db_handler_require_admin(is_array($sessionUser) ? $sessionUser : []);
    } else {
        db_handler_require_admin([]);
    }

    ensure_database_and_table($cfg['host'], $cfg['user'], $cfg['pass'], $dbname);

    json_response(200, [
        'status' => 'success',
        'message' => "データベース接続に成功し、{$dbname} と logintable を準備しました！",
    ]);
}

function handle_db_action(string $action, array $input, array $cfg): void
{
    $host = $cfg['host'];
    $user = $cfg['user'];
    $pass = $cfg['pass'];
    $dbname = $cfg['dbname'];

    if (empty($_SESSION['user_id'])) {
        db_handler_json_error(401, 'ログインセッションが無効です。');
    }

    $authPdo = create_base_pdo($host, $user, $pass, $dbname);
    $sessionUser = require_session_user($authPdo);
    if ($action !== 'save_login') {
        db_handler_require_admin(is_array($sessionUser) ? $sessionUser : []);
    }

    switch ($action) {
        case 'check_db':
            json_response(200, [
                'status' => 'success',
                'exists' => check_database_exists($host, $user, $pass, $dbname),
            ]);

        case 'create':
            db_handler_guard_non_production('create', 'データベース作成');
            create_database_if_needed($host, $user, $pass, $dbname);
            json_response(200, [
                'status' => 'success',
                'message' => "データベース「{$dbname}」の作成に成功しました！",
            ]);

        case 'create_table':
            db_handler_guard_non_production('create_table', 'テーブル作成');
            create_logintable_if_needed($host, $user, $pass, $dbname);
            json_response(200, [
                'status' => 'success',
                'message' => '「logintable」テーブルの作成に成功しました！',
            ]);

        case 'save_login':
            $res = save_login_record($host, $user, $pass, $dbname, $sessionUser, $input);
            $payload = is_array($res['payload'] ?? null)
                ? $res['payload']
                : ['status' => 'error', 'message' => 'ログイン情報の保存に失敗しました。'];
            $statusCode = isset($res['status']) && is_int($res['status'])
                ? $res['status']
                : ((($payload['status'] ?? '') === 'error') ? 400 : 200);
            json_response($statusCode, $payload);

        case 'get_logs':
            json_response(200, [
                'status' => 'success',
                'data' => fetch_login_records($host, $user, $pass, $dbname),
            ]);

        case 'reset_logs':
            db_handler_guard_non_production('reset_logs', 'ログイン履歴リセット');
            clear_login_records($host, $user, $pass, $dbname);
            json_response(200, [
                'status' => 'success',
                'message' => 'データベースのログイン履歴をすべて削除しました！',
            ]);

        default:
            create_base_pdo($host, $user, $pass, null);
            json_response(200, ['status' => 'success', 'message' => 'データベース接続に成功しました！']);
    }
}

function handle_db_pdo_exception(PDOException $e, string $action): never
{
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

    $extra = [];
    if (db_handler_is_debug_enabled()) {
        $extra['debug'] = $errorMsg;
    }
    db_handler_json_error(500, $specificError, $extra);
}