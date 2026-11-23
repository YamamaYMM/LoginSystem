<?php
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

function validate_registration_input(string $name, string $id, string $password, string $role): ?string {
    if ($name === '' || $id === '' || $password === '') {
        return 'すべての項目を入力してください。';
    }
    if (mb_strlen($id) < 8 || mb_strlen($password) < 8) {
        return 'IDおよびパスワードは8文字以上で入力してください。';
    }
    if (!in_array($role, ['master', 'submaster', 'general'], true)) {
        return 'ロールが不正です。';
    }
    return null;
}

function format_safe_users(array $rows): array {
    return array_map(static fn(array $r) => [
        'id' => $r['id'],
        'name' => $r['name'],
        'role' => $r['role'],
        'isManager' => (bool)$r['is_manager'],
    ], $rows);
}

function fetch_safe_users(PDO $pdo): array {
    $stmt = $pdo->query("SELECT id, name, role, is_manager FROM users ORDER BY created_at ASC");
    return format_safe_users($stmt->fetchAll());
}

function check_registration_conflicts(PDO $pdo, string $id, string $name, string $role): ?string {
    $dupStmt = $pdo->prepare("SELECT id, name FROM users WHERE id = ? OR name = ? LIMIT 1");
    $dupStmt->execute([$id, $name]);
    if ($dup = $dupStmt->fetch()) {
        return $dup['id'] === $id ? 'このIDはすでに使用されています' : 'この名前はすでに登録されています';
    }

    if ($role === 'master') {
        $cnt = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'master'")->fetchColumn();
        if ($cnt >= 1) {
            return 'マスターアカウントは既に1つ登録されているため作成できません';
        }
    } elseif ($role === 'submaster') {
        $cnt = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'submaster'")->fetchColumn();
        if ($cnt >= 4) {
            return 'サブマスターアカウントは最大4つまでです';
        }
    }

    return null;
}