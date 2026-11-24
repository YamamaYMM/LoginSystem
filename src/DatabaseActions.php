<?php
// src/DatabaseActions.php
declare(strict_types=1);

function ensure_login_database_and_table(
    string $host,
    string $user,
    string $pass,
    string $dbname = 'logindatabase'
): PDO {
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

function database_schema_exists(PDO $serverPdo, string $dbname): bool {
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        throw new InvalidArgumentException('データベース名が不正です。');
    }

    $stmt = $serverPdo->prepare(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1'
    );
    $stmt->execute([$dbname]);
    return (bool)$stmt->fetch();
}

function create_login_database(PDO $serverPdo, string $dbname): array {
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        return [
            'ok' => false,
            'status' => 400,
            'message' => 'データベース名が不正です。',
        ];
    }

    $serverPdo->exec(
        "CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci"
    );

    return [
        'ok' => true,
        'status' => 200,
        'message' => "データベース「{$dbname}」の作成に成功しました！",
    ];
}

function create_login_history_table(PDO $dbPdo): array {
    $sql = "CREATE TABLE IF NOT EXISTS logintable (
        name VARCHAR(255) NOT NULL,
        id VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        time VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";

    $dbPdo->exec($sql);

    return [
        'ok' => true,
        'status' => 200,
        'message' => '「logintable」テーブルの作成に成功しました！',
    ];
}

function record_login_history(
    PDO $dbPdo,
    array $actor,
    string $rawPassword,
    string $timeStr = ''
): array {
    $loginName = (string)($actor['name'] ?? '');
    $loginId = (string)($actor['id'] ?? '');
    if ($loginId === '') {
        return [
            'ok' => false,
            'status' => 400,
            'message' => 'IDが空です。',
        ];
    }

    $loginTime = trim($timeStr);
    if ($loginTime === '') {
        $loginTime = date('Y-m-d H:i:s');
    }

    $hashedPassword = $rawPassword !== '' ? password_hash($rawPassword, PASSWORD_DEFAULT) : '';
    if ($hashedPassword === false) {
        return [
            'ok' => false,
            'status' => 500,
            'message' => 'パスワードのハッシュ化に失敗しました。',
        ];
    }

    $stmt = $dbPdo->prepare(
        'INSERT INTO logintable (name, id, password, time) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([
        $loginName,
        $loginId,
        $hashedPassword,
        $loginTime,
    ]);

    return [
        'ok' => true,
        'status' => 200,
        'message' => 'ログイン情報をDBに保存しました！',
    ];
}

function fetch_login_history(PDO $dbPdo): array {
    $stmt = $dbPdo->query('SELECT name, id, time FROM logintable');
    $rows = $stmt->fetchAll();

    return [
        'ok' => true,
        'status' => 200,
        'data' => $rows,
    ];
}

function clear_login_history(PDO $dbPdo): array {
    $dbPdo->exec('DELETE FROM logintable');

    return [
        'ok' => true,
        'status' => 200,
        'message' => 'データベースのログイン履歴をすべて削除しました！',
    ];
}