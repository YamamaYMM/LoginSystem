<?php
// src/AuthManagement.php
declare(strict_types=1);

require_once __DIR__ . '/AuthHelpers.php';

/**
 * ユーザーIDとパスワードで認証する。
 * 成功時はユーザー配列を返し、失敗時は null を返す。
 */
function authenticate_user(PDO $pdo, string $userId, string $password): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, name, password_hash, role, is_manager FROM users WHERE id = ? LIMIT 1'
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch();

    if (!$row || !is_string($row['password_hash']) || !password_verify($password, $row['password_hash'])) {
        return null;
    }

    return [
        'id' => (string)$row['id'],
        'name' => (string)$row['name'],
        'role' => (string)$row['role'],
        'isManager' => (bool)$row['is_manager'],
    ];
}

/**
 * logintable にログイン履歴を記録する。
 */
function record_login_history(
    PDO $pdo,
    string $name,
    string $userId,
    string $maskedOrStatusLabel = 'authenticated',
    ?string $timestamp = null
): void {
    $recordedAt = $timestamp ?? date('Y-m-d H:i:s');
    $stmt = $pdo->prepare(
        'INSERT INTO logintable (name, id, password, time) VALUES (?, ?, ?, ?)'
    );
    $stmt->execute([$name, $userId, $maskedOrStatusLabel, $recordedAt]);
}

/**
 * 権限チェック（can_manage_target）を通過した場合のみ対象ユーザーのロールを更新する。
 * 権限不足または対象ユーザー不在の場合は false を返す。
 */
function change_user_role(
    PDO $pdo,
    string $actorRole,
    string $actorId,
    string $targetUserId,
    string $newRole,
    ?bool $isManager = null
): bool {
    if (!in_array($newRole, ['master', 'submaster', 'general'], true)) {
        throw new InvalidArgumentException('不正なロールが指定されました。');
    }

    $stmt = $pdo->prepare('SELECT id, role, is_manager FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetUserId]);
    $target = $stmt->fetch();

    if (!$target) {
        return false;
    }

    if (!can_manage_target($actorRole, $actorId, $target)) {
        return false;
    }

    $nextIsManager = $isManager ?? ($newRole !== 'general' ? 1 : 0);

    $update = $pdo->prepare('UPDATE users SET role = ?, is_manager = ? WHERE id = ?');
    return $update->execute([$newRole, $nextIsManager ? 1 : 0, $targetUserId]);
}