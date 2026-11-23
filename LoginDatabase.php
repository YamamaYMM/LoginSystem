<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

start_secure_session();
header('Content-Type: application/json; charset=utf-8');

function ensure_database_and_table(string $host, string $user, string $pass, string $dbname = 'logindatabase'): PDO {
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        throw new InvalidArgumentException('データベース名が不正です。');
    }

    $serverPdo = create_base_pdo($host, $user, $pass, null);
    $serverPdo->exec(
        "CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
    );

    $dbPdo = create_base_pdo($host, $user, $pass, $dbname);
    $dbPdo->exec("CREATE TABLE IF NOT EXISTS logintable (
        name VARCHAR(255) NOT NULL,
        id VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        time VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");

    return $dbPdo;
}

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
        $serverAuthPdo = create_base_pdo($host, $user, $pass, null);
        $serverAuthPdo->exec('USE `information_schema`');

        if (empty($_SESSION['user_id'])) {
            json_response(401, ['status' => 'error', 'message' => 'ログインセッションが無効です。']);
        }

        ensure_database_and_table($host, $user, $pass, $dbname);

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
        $stmt = $pdo->prepare(
            'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1'
        );
        $stmt->execute([$dbname]);
        $exists = (bool)$stmt->fetch();

        json_response(200, ['status' => 'success', 'exists' => $exists]);

    } elseif ($action === 'create') {
        if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
            json_response(400, ['status' => 'error', 'message' => 'データベース名が不正です。']);
        }
        $pdo = create_base_pdo($host, $user, $pass);

        $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");

        json_response(200, ['status' => 'success', 'message' => "データベース「{$dbname}」の作成に成功しました！"]);

    } elseif ($action === 'create_table') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);

        $sql = "CREATE TABLE IF NOT EXISTS logintable (
            name VARCHAR(255) NOT NULL,
            id VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            time VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";

        $pdo->exec($sql);

        json_response(200, ['status' => 'success', 'message' => '「logintable」テーブルの作成に成功しました！']);

    } elseif ($action === 'save_login') {
        $login_name = $sessionUser['name'];
        $login_id = $sessionUser['id'];
        $login_pass = (string)($input['password'] ?? '');
        $login_time = trim((string)($input['time'] ?? ''));
        if ($login_time === '') {
            $login_time = date('Y-m-d H:i:s');
        }

        if ($login_id === '') {
            json_response(400, ['status' => 'error', 'message' => 'IDが空です。']);
        }

        $pdo = create_base_pdo($host, $user, $pass, $dbname);

        $hashed_password = $login_pass !== '' ? password_hash($login_pass, PASSWORD_DEFAULT) : '';
        if ($hashed_password === false) {
            json_response(500, ['status' => 'error', 'message' => 'パスワードのハッシュ化に失敗しました。']);
        }

        $stmt = $pdo->prepare(
            "INSERT INTO logintable (name, id, password, time) VALUES (?, ?, ?, ?)"
        );
        $stmt->execute([
            $login_name,
            $login_id,
            $hashed_password,
            $login_time,
        ]);

        json_response(200, ['status' => 'success', 'message' => 'ログイン情報をDBに保存しました！']);

    } elseif ($action === 'get_logs') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);

        // パスワード列は一覧取得時に返さないようにする
        $stmt = $pdo->query("SELECT name, id, time FROM logintable");
        $rows = $stmt->fetchAll();

        json_response(200, ['status' => 'success', 'data' => $rows]);

    } elseif ($action === 'reset_logs') {
        $pdo = create_base_pdo($host, $user, $pass, $dbname);
        $pdo->exec("DELETE FROM logintable");

        json_response(200, ['status' => 'success', 'message' => 'データベースのログイン履歴をすべて削除しました！']);

    } else {
        create_base_pdo($host, $user, $pass, null);

        json_response(200, ['status' => 'success', 'message' => 'データベース接続に成功しました！']);
    }
} catch (PDOException $e) {
    $errorMsg = $e->getMessage();
    $specificError = "データベース接続に失敗しました。";

    if (
        strpos($errorMsg, 'No such host') !== false ||
        strpos($errorMsg, 'getaddrinfo') !== false ||
        strpos($errorMsg, 'Name or service not known') !== false
    ) {
        $specificError = "Host（ホスト名）が間違っているか、存在しません。";
    } elseif (strpos($errorMsg, 'Access denied for user') !== false) {
        $specificError = "User（ユーザー名）または Password（パスワード）が間違っています。";
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