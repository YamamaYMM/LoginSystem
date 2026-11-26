<?php
declare(strict_types=1);

function assert_test_environment(): void
{
    $env = strtolower(trim((string)(getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? ''))));
    if ($env !== 'test') {
        throw new RuntimeException('テスト用DB操作は APP_ENV=test のときのみ許可されます。');
    }
}

function reset_test_database_state(PDO $pdo, string $dbname): void
{
    assert_test_environment();

    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbname)) {
        throw new InvalidArgumentException('データベース名が不正です。');
    }

    $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
    $pdo->exec("USE `{$dbname}`");

    // 存在するテーブルのみ安全にクリーンアップ
    foreach (['logintable', 'users'] as $table) {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?'
        );
        $stmt->execute([$dbname, $table]);
        if ((int)$stmt->fetchColumn() > 0) {
            $pdo->exec("DELETE FROM `{$table}`");
        }
    }
}

function seed_test_master_user(PDO $pdo, string $id = 'test_master_01', string $name = 'テスト管理者', string $password = 'Password123!'): array
{
    assert_test_environment();

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare(
        'INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, 1)'
    );
    $stmt->execute([$id, $name, $hash, 'master']);

    return ['id' => $id, 'name' => $name, 'password' => $password, 'role' => 'master'];
}