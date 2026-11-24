<?php
// bootstrap.php
declare(strict_types=1);

if (date_default_timezone_get() !== 'Asia/Tokyo') {
    date_default_timezone_set('Asia/Tokyo');
}

function app_env_name(): string {
    $val = getenv('APP_ENV');
    if ($val !== false && trim($val) !== '') {
        return strtolower(trim((string)$val));
    }
    if (isset($_ENV['APP_ENV']) && trim((string)$_ENV['APP_ENV']) !== '') {
        return strtolower(trim((string)$_ENV['APP_ENV']));
    }
    return 'production';
}

function is_production(): bool {
    return is_production_env();
}

function is_production_env(): bool {
    return app_env_name() === 'production';
}

function is_debug_env(): bool {
    return in_array(app_env_name(), ['local', 'test', 'development'], true);
}

function configure_runtime_error_handling(?string $logDir = null): void {
    error_reporting(E_ALL);
    ini_set('log_errors', '1');

    $targetDir = $logDir ?? (__DIR__ . '/logs');
    if (!is_dir($targetDir)) {
        @mkdir($targetDir, 0755, true);
    }
    if (is_dir($targetDir) && is_writable($targetDir)) {
        ini_set('error_log', $targetDir . '/php_error.log');
    }

    if (is_production_env()) {
        ini_set('display_errors', '0');
        ini_set('display_startup_errors', '0');
    } else {
        ini_set('display_errors', '1');
        ini_set('display_startup_errors', '1');
    }
}

configure_runtime_error_handling();

function load_db_config(): array {
    $cfgFile = __DIR__ . '/db_config.php';
    $fileCfg = file_exists($cfgFile) ? require $cfgFile : [];
    if (!is_array($fileCfg)) {
        $fileCfg = [];
    }

    $envOr = static function (string $key, mixed $fallback): string {
        $val = getenv($key);
        if ($val !== false && $val !== '') {
            return (string)$val;
        }
        if (isset($_ENV[$key]) && $_ENV[$key] !== '') {
            return (string)$_ENV[$key];
        }
        return (string)$fallback;
    };

    $host = $envOr('DB_HOST', $fileCfg['host'] ?? '127.0.0.1');
    $user = $envOr('DB_USER', $fileCfg['user'] ?? '');
    $pass = getenv('DB_PASS') !== false
        ? (string)getenv('DB_PASS')
        : (string)($_ENV['DB_PASS'] ?? ($fileCfg['pass'] ?? ''));
    $dbname = $envOr('DB_NAME', $fileCfg['dbname'] ?? 'logindatabase');

    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        throw new InvalidArgumentException('不正なデータベース名です。');
    }

    $appEnv = strtolower((string)(getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? '')));
    if ($appEnv === 'production' && ($host === '' || $user === '')) {
        throw new RuntimeException('本番環境のDB接続環境変数（DB_HOST / DB_USER）が設定されていません。');
    }

    return [
        'host' => $host,
        'user' => $user,
        'pass' => $pass,
        'dbname' => $dbname,
    ];
}

function get_configured_dbname(): string {
    return load_db_config()['dbname'];
}

function json_response(int $statusCode, array $payload): never {
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
    }
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function start_secure_session(): string {
    if (session_status() !== PHP_SESSION_ACTIVE) {
        $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['SERVER_PORT'] ?? '') === '443');

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $isHttps,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);

        session_start();
    }

    if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function get_csrf_token(): string {
    return start_secure_session();
}

function verify_csrf_token(array $input = []): void {
    $expected = (string)($_SESSION['csrf_token'] ?? '');
    $headerToken = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    $bodyToken = (string)($input['csrf_token'] ?? '');
    $provided = $headerToken !== '' ? $headerToken : $bodyToken;

    if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
        json_response(403, [
            'status' => 'error',
            'message' => '不正なリクエストです（CSRFトークンが無効です）。',
        ]);
    }
}

function read_json_input(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        json_response(400, ['status' => 'error', 'message' => '不正なJSONリクエストです。']);
    }
    return $decoded;
}

function create_base_pdo(string $host, string $user, string $pass, ?string $dbname = null): PDO {
    if ($dbname !== null && $dbname !== '') {
        if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
            throw new InvalidArgumentException('不正なデータベース名です。');
        }
        $dsn = "mysql:host={$host};dbname={$dbname};charset=utf8mb4";
    } else {
        $dsn = "mysql:host={$host};charset=utf8mb4";
    }

    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function get_pdo(bool $requireExistingDb = true): PDO {
    $cfg = load_db_config();
    $dbname = $cfg['dbname'];

    $pdo = create_base_pdo($cfg['host'], $cfg['user'], $cfg['pass'], null);

    if ($requireExistingDb) {
        $stmt = $pdo->prepare(
            'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1'
        );
        $stmt->execute([$dbname]);
        if (!$stmt->fetch()) {
            throw new RuntimeException('データベースが存在しません。マスターアカウントを作成してください。');
        }
    }

    $pdo->exec("USE `{$dbname}`");
    return $pdo;
}

function init_db_and_tables_from_credentials(
    string $host,
    string $user,
    string $pass,
    string $dbname = 'logindatabase'
): PDO {
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        throw new InvalidArgumentException('不正なデータベース名です。');
    }

    $serverPdo = create_base_pdo($host, $user, $pass, null);
    $serverPdo->exec(
        "CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
    );
    $serverPdo->exec("USE `{$dbname}`");

    $serverPdo->exec("
        CREATE TABLE IF NOT EXISTS `users` (
            id VARCHAR(64) NOT NULL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('master', 'submaster', 'general') NOT NULL DEFAULT 'general',
            is_manager TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    $serverPdo->exec("
        CREATE TABLE IF NOT EXISTS `logintable` (
            name VARCHAR(255) NOT NULL,
            id VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            time VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");

    return $serverPdo;
}

function drop_database_if_users_empty(PDO $pdo, ?string $dbname = null): bool {
    $targetDb = $dbname ?? get_configured_dbname();
    if (!preg_match('/^[A-Za-z0-9_]+$/', $targetDb)) {
        throw new InvalidArgumentException('不正なデータベース名です。');
    }

    $count = (int)$pdo->query("SELECT COUNT(*) FROM `users`")->fetchColumn();
    if ($count > 0) {
        return false;
    }

    $pdo->exec("USE `information_schema`");
    $pdo->exec("DROP DATABASE IF EXISTS `{$targetDb}`");
    return true;
}

function require_session_user(PDO $pdo): array {
    if (empty($_SESSION['user_id'])) {
        json_response(401, ['status' => 'error', 'message' => 'ログインセッションが無効です。']);
    }

    $stmt = $pdo->prepare('SELECT id, name, role, is_manager FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();

    if (!$user) {
        $_SESSION = [];
        session_destroy();
        json_response(401, ['status' => 'error', 'message' => 'セッションユーザーが存在しません。']);
    }

    $_SESSION['user_name'] = (string)$user['name'];
    $_SESSION['role'] = (string)$user['role'];
    $_SESSION['is_manager'] = (bool)$user['is_manager'];

    return [
        'id' => (string)$user['id'],
        'name' => (string)$user['name'],
        'role' => (string)$user['role'],
        'isManager' => (bool)$user['is_manager'],
    ];
}

function require_admin_role(array $user): void {
    $role = (string)($user['role'] ?? '');
    if (!in_array($role, ['master', 'submaster'], true)) {
        json_response(403, ['status' => 'error', 'message' => '管理者権限（マスター／サブマスター）が必要です。']);
    }
}