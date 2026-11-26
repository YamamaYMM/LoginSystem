<?php
declare(strict_types=1);

function db_actions_is_production(): bool
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

function assert_valid_dbname(string $dbname): void
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        throw new InvalidArgumentException('データベース名が不正です。');
    }
}

function ensure_database_and_table(string $host, string $user, string $pass, string $dbname = 'logindatabase'): PDO
{
    assert_valid_dbname($dbname);

    $serverPdo = create_base_pdo($host, $user, $pass, null);
    $serverPdo->exec(
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

    return $dbPdo;
}

function check_database_exists(string $host, string $user, string $pass, string $dbname): bool
{
    assert_valid_dbname($dbname);
    $pdo = create_base_pdo($host, $user, $pass);
    $stmt = $pdo->prepare(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1'
    );
    $stmt->execute([$dbname]);
    return (bool)$stmt->fetch();
}

function create_database_if_needed(string $host, string $user, string $pass, string $dbname): void
{
    assert_valid_dbname($dbname);
    $pdo = create_base_pdo($host, $user, $pass);
    $pdo->exec(
        "CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
    );
}

function create_logintable_if_needed(string $host, string $user, string $pass, string $dbname): void
{
    assert_valid_dbname($dbname);
    $pdo = create_base_pdo($host, $user, $pass, $dbname);
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS logintable (
            name VARCHAR(255) NOT NULL,
            id VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            time VARCHAR(255) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
    );
}

function save_login_record(string $host, string $user, string $pass, string $dbname, array $sessionUser, array $input): array
{
    assert_valid_dbname($dbname);

    $loginName = (string)($sessionUser['name'] ?? $_SESSION['user_name'] ?? $input['name'] ?? '');
    $loginId = (string)($sessionUser['id'] ?? $_SESSION['user_id'] ?? '');
    $loginPass = (string)($input['password'] ?? '');
    $loginTime = trim((string)($input['time'] ?? ''));
    if ($loginTime === '') {
        $loginTime = date('Y-m-d H:i:s');
    }

    if ($loginId === '') {
        return ['status' => 400, 'payload' => ['status' => 'error', 'message' => 'IDが空です。']];
    }

    $hashedPassword = $loginPass !== '' ? password_hash($loginPass, PASSWORD_DEFAULT) : '';
    if ($hashedPassword === false) {
        return ['status' => 500, 'payload' => ['status' => 'error', 'message' => 'パスワードのハッシュ化に失敗しました。']];
    }

    $pdo = create_base_pdo($host, $user, $pass, $dbname);
    $stmt = $pdo->prepare(
        'INSERT INTO logintable (name, id, password, time) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$loginName, $loginId, $hashedPassword, $loginTime]);

    return ['status' => 200, 'payload' => ['status' => 'success', 'message' => 'ログイン情報をDBに保存しました！']];
}

function fetch_login_records(string $host, string $user, string $pass, string $dbname): array
{
    assert_valid_dbname($dbname);
    $pdo = create_base_pdo($host, $user, $pass, $dbname);
    // パスワード列は一覧取得時に返さないようにする
    $stmt = $pdo->query('SELECT name, id, time FROM logintable');
    return $stmt ? $stmt->fetchAll() : [];
}

function clear_login_records(string $host, string $user, string $pass, string $dbname): void
{
    assert_valid_dbname($dbname);
    if (db_actions_is_production()) {
        throw new RuntimeException('本番環境ではログイン履歴の一括削除は許可されていません。');
    }

    $pdo = create_base_pdo($host, $user, $pass, $dbname);
    $pdo->exec('DELETE FROM logintable');
}