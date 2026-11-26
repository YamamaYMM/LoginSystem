<?php
declare(strict_types=1);

if (!function_exists('resolve_app_env')) {
    function resolve_app_env(): string
    {
        if (function_exists('app_env_name')) {
            $env = app_env_name();
            if (in_array($env, ['production', 'prod'], true)) {
                return 'production';
            }
            if (in_array($env, ['test', 'testing'], true)) {
                return 'test';
            }
            if (in_array($env, ['local', 'development', 'dev'], true)) {
                return 'local';
            }
            return 'production';
        }

        $raw = getenv('APP_ENV');
        if ($raw === false || trim((string)$raw) === '') {
            $raw = $_ENV['APP_ENV'] ?? $_SERVER['APP_ENV'] ?? 'production';
        }

        $normalized = strtolower(trim((string)$raw));
        if (in_array($normalized, ['production', 'prod'], true)) {
            return 'production';
        }
        if (in_array($normalized, ['test', 'testing'], true)) {
            return 'test';
        }
        if (in_array($normalized, ['local', 'development', 'dev'], true)) {
            return 'local';
        }

        return 'production';
    }
}

if (!function_exists('is_production_env')) {
    function is_production_env(): bool
    {
        return resolve_app_env() === 'production';
    }
}

if (!function_exists('is_non_production_env')) {
    function is_non_production_env(): bool
    {
        return !is_production_env();
    }
}

function is_debug_env_enabled(): bool
{
    return in_array(resolve_app_env(), ['local', 'test'], true);
}

function json_error(int $statusCode, string $message, array $extra = []): never
{
    json_response($statusCode, array_merge([
        'status' => 'error',
        'message' => $message,
    ], $extra));
}

function resolve_session_role(?array $sessionUser): string
{
    if (is_array($sessionUser) && isset($sessionUser['role']) && is_string($sessionUser['role'])) {
        $dbRole = strtolower(trim($sessionUser['role']));
        if ($dbRole !== '') {
            return $dbRole;
        }
    }

    return strtolower(trim((string)($_SESSION['role'] ?? $_SESSION['user_role'] ?? '')));
}

/**
 * 認証（401）と認可（403）を最前線で一括評価し、必要に応じて DB ユーザー行を返す。
 *
 * @return array<string, mixed>|null
 */
function authorize_login_db_request(string $action, array $cfg): ?array
{
    if (empty($_SESSION['user_id'])) {
        json_error(401, 'ログインセッションが無効です。');
    }

    $requiresAdmin = ($action !== 'save_login');
    $host = (string)($cfg['host'] ?? '');
    $user = (string)($cfg['user'] ?? '');
    $pass = (string)($cfg['pass'] ?? '');
    $dbname = (string)($cfg['dbname'] ?? '');

    $sessionUser = null;
    if ($host !== '' && $user !== '' && $dbname !== '' && preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        $serverPdo = create_base_pdo($host, $user, $pass, null);
        $hasSchema = function_exists('database_schema_exists')
            ? (bool)database_schema_exists($serverPdo, $dbname)
            : false;

        if ($hasSchema && function_exists('require_session_user')) {
            $dbPdo = create_base_pdo($host, $user, $pass, $dbname);
            $resolved = require_session_user($dbPdo);
            if (is_array($resolved)) {
                $sessionUser = $resolved;
            }
        }
    }

    if ($requiresAdmin) {
        $role = resolve_session_role($sessionUser);
        if (!in_array($role, ['master', 'submaster', 'admin'], true)) {
            json_error(403, '管理者権限が必要です。');
        }
    }

    return $sessionUser;
}

function guard_login_db_request(string $action, bool $isDisconnected, array $cfg): void
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
        json_error(400, 'データベース接続がOFFになっています。');
    }

    if ($cfg['host'] === '' || $cfg['user'] === '') {
        json_error(500, 'サーバーのDB接続環境変数（DB_HOST / DB_USER）が未設定です。');
    }
}

function run_login_db_connect(array $cfg): void
{
    $host = $cfg['host'];
    $user = $cfg['user'];
    $pass = $cfg['pass'];
    $dbname = $cfg['dbname'];

    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        json_error(400, 'データベース名が不正です。');
    }

    authorize_login_db_request('connect_db', $cfg);

    $serverAuthPdo = create_base_pdo($host, $user, $pass, null);

    if (function_exists('ensure_login_database_and_table')) {
        ensure_login_database_and_table($host, $user, $pass, $dbname);
    } else {
        $serverAuthPdo->exec(
            "CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
        );
        $dbPdo = create_base_pdo($host, $user, $pass, $dbname);
        $dbPdo->exec(
            "CREATE TABLE IF NOT EXISTS logintable (
                name VARCHAR(255) NOT NULL,
                id VARCHAR(255) NOT NULL,
                password VARCHAR(255) NOT NULL,
                time VARCHAR(255) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
        );
    }

    json_response(200, [
        'status' => 'success',
        'message' => "データベース接続に成功し、{$dbname} と logintable を準備しました！",
    ]);
}

function run_login_db_action(string $action, array $input, array $cfg, ?array $authorizedUser = null): void
{
    $host = $cfg['host'];
    $user = $cfg['user'];
    $pass = $cfg['pass'];
    $dbname = $cfg['dbname'];

    if ($authorizedUser === null) {
        $authorizedUser = authorize_login_db_request($action, $cfg);
    }
    $sessionUser = is_array($authorizedUser) ? $authorizedUser : [];

    if ($action === 'check_db') {
        $exists = function_exists('check_database_exists')
            ? (bool)check_database_exists($host, $user, $pass, $dbname)
            : false;
        json_response(200, ['status' => 'success', 'exists' => $exists]);
        return;
    }

    if ($action === 'create') {
        if (function_exists('create_database_if_needed')) {
            create_database_if_needed($host, $user, $pass, $dbname);
        }
        json_response(200, [
            'status' => 'success',
            'message' => "データベース「{$dbname}」の作成に成功しました！",
        ]);
        return;
    }

    if ($action === 'create_table') {
        if (function_exists('create_logintable_if_needed')) {
            create_logintable_if_needed($host, $user, $pass, $dbname);
        }
        json_response(200, [
            'status' => 'success',
            'message' => '「logintable」テーブルの作成に成功しました！',
        ]);
        return;
    }

    if ($action === 'save_login') {
        if (function_exists('save_login_record')) {
            /** @var mixed $rawResult */
            $rawResult = save_login_record($host, $user, $pass, $dbname, $sessionUser, $input);
            /** @var array<string, mixed> $result */
            $result = is_array($rawResult) ? $rawResult : [];

            $payload = (isset($result['payload']) && is_array($result['payload']))
                ? $result['payload']
                : ['status' => 'error', 'message' => 'ログイン情報の保存に失敗しました。'];
            $isErrorPayload = (($payload['status'] ?? '') === 'error');
            $statusCode = (isset($result['status']) && is_int($result['status']))
                ? $result['status']
                : ($isErrorPayload ? 400 : 200);

            json_response($statusCode, $payload);
            return;
        }

        $pdo = create_base_pdo($host, $user, $pass, $dbname);
        $loginName = (string)($sessionUser['name'] ?? '');
        $loginId = (string)($sessionUser['id'] ?? '');
        $loginPass = (string)($input['password'] ?? '');
        $loginTime = trim((string)($input['time'] ?? ''));
        if ($loginTime === '') {
            $loginTime = date('Y-m-d H:i:s');
        }
        if ($loginId === '') {
            json_error(400, 'IDが空です。');
        }
        $hashedPassword = $loginPass !== '' ? password_hash($loginPass, PASSWORD_DEFAULT) : '';
        if ($hashedPassword === false) {
            json_error(500, 'パスワードのハッシュ化に失敗しました。');
        }
        $stmt = $pdo->prepare('INSERT INTO logintable (name, id, password, time) VALUES (?, ?, ?, ?)');
        $stmt->execute([$loginName, $loginId, $hashedPassword, $loginTime]);
        json_response(200, ['status' => 'success', 'message' => 'ログイン情報をDBに保存しました！']);
    }

    if ($action === 'get_logs') {
        $rows = function_exists('fetch_login_records')
            ? fetch_login_records($host, $user, $pass, $dbname)
            : [];
        json_response(200, [
            'status' => 'success',
            'data' => is_array($rows) ? $rows : [],
        ]);
        return;
    }

    if ($action === 'reset_logs') {
        if (function_exists('clear_login_records')) {
            clear_login_records($host, $user, $pass, $dbname);
        }
        json_response(200, [
            'status' => 'success',
            'message' => 'データベースのログイン履歴をすべて削除しました！',
        ]);
        return;
    }

    create_base_pdo($host, $user, $pass, null);
    json_response(200, ['status' => 'success', 'message' => 'データベース接続に成功しました！']);
}

function handle_login_db_pdo_exception(PDOException $e, string $action): void
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
    if (is_debug_env_enabled()) {
        $extra['debug'] = $errorMsg;
    }
    json_error(500, $specificError, $extra);
}

function dispatch_login_db_request(string $action, array $input, array $cfg): void
{
    try {
        if ($action === 'connect_db' || $action === 'test') {
            run_login_db_connect($cfg);
            return;
        }
        $authorizedUser = authorize_login_db_request($action, $cfg);
        run_login_db_action($action, $input, $cfg, $authorizedUser);
    } catch (PDOException $e) {
        handle_login_db_pdo_exception($e, $action);
    }
}