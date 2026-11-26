<?php
declare(strict_types=1);

require_once __DIR__ . '/AuthHelpers.php';

function validate_registration_input(string $name, string $id, string $password, string $role): ?string
{
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

function check_registration_conflicts(PDO $pdo, string $id, string $name, string $role): ?string
{
    $dupStmt = $pdo->prepare('SELECT id, name FROM users WHERE id = ? OR name = ? LIMIT 1');
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