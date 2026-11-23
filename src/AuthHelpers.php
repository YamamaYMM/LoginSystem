<?php
// src/AuthHelpers.php
declare(strict_types=1);

function can_manage_target(string $actorRole, string $actorId, array $targetUser): bool {
    $targetId = (string)($targetUser['id'] ?? '');
    $targetRole = (string)($targetUser['role'] ?? 'general');

    if ($targetId === '' || $actorId === $targetId) {
        return false;
    }
    if ($actorRole === 'master') {
        return $targetRole !== 'master';
    }
    if ($actorRole === 'submaster') {
        return $targetRole !== 'master' && $targetRole !== 'submaster';
    }
    return false;
}

function fetch_safe_users(PDO $pdo): array {
    $stmt = $pdo->query("SELECT id, name, role, is_manager FROM users ORDER BY created_at ASC, id ASC");
    $rows = $stmt->fetchAll();
    return array_map(static fn(array $r) => [
        'id' => $r['id'],
        'name' => $r['name'],
        'role' => $r['role'],
        'isManager' => (bool)$r['is_manager'],
    ], $rows);
}