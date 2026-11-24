<?php
// src/AuthActions.php
declare(strict_types=1);

require_once __DIR__ . '/AuthHelpers.php';

function register_user_account(PDO $pdo, array $input): array
{
    $name = trim((string)($input['name'] ?? ''));
    $id = trim((string)($input['id'] ?? ''));
    $password = (string)($input['password'] ?? '');
    $role = (string)($input['role'] ?? 'general');

    if ($name === '' || $id === '' || $password === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'すべての項目を入力してください。'];
    }
    if (mb_strlen($id) < 8 || mb_strlen($password) < 8) {
        return ['ok' => false, 'status' => 400, 'message' => 'IDおよびパスワードは8文字以上で入力してください。'];
    }
    if (!in_array($role, ['master', 'submaster', 'general'], true)) {
        $role = 'general';
    }

    $dupStmt = $pdo->prepare('SELECT id, name FROM users WHERE id = ? OR name = ? LIMIT 1');
    $dupStmt->execute([$id, $name]);
    if ($dup = $dupStmt->fetch()) {
        $msg = $dup['id'] === $id ? 'このIDはすでに使用されています' : 'この名前はすでに登録されています';
        return ['ok' => false, 'status' => 409, 'message' => $msg];
    }

    if ($role === 'master') {
        $cnt = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'master'")->fetchColumn();
        if ($cnt >= 1) {
            return ['ok' => false, 'status' => 409, 'message' => 'マスターアカウントは既に1つ登録されているため作成できません'];
        }
    } elseif ($role === 'submaster') {
        $cnt = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'submaster'")->fetchColumn();
        if ($cnt >= 4) {
            return ['ok' => false, 'status' => 409, 'message' => 'サブマスターアカウントは最大4つまでです'];
        }
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $ins = $pdo->prepare('INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, 0)');
    $ins->execute([$id, $name, $hash, $role]);

    return [
        'ok' => true,
        'status' => 201,
        'message' => 'アカウント登録が完了しました。',
        'user' => ['id' => $id, 'name' => $name, 'role' => $role, 'isManager' => false],
    ];
}

function verify_login_credentials(PDO $pdo, string $name, string $id, string $password): array
{
    $name = trim($name);
    $id = trim($id);

    if ($name === '' || $id === '' || $password === '') {
        return ['ok' => false, 'status' => 400, 'message' => 'お名前、ID、パスワードをすべて入力してください'];
    }

    $stmt = $pdo->prepare('SELECT id, name, password_hash, role, is_manager FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $user = $stmt->fetch();

    if (!$user) {
        return ['ok' => false, 'status' => 401, 'message' => 'このIDは登録されていません。新規登録を行ってください。'];
    }
    if (!password_verify($password, (string)$user['password_hash'])) {
        return ['ok' => false, 'status' => 401, 'message' => 'パスワードが間違っています'];
    }
    if ($user['name'] !== $name) {
        return ['ok' => false, 'status' => 401, 'message' => '登録されているお名前と一致しません'];
    }

    return [
        'ok' => true,
        'status' => 200,
        'user' => [
            'id' => (string)$user['id'],
            'name' => (string)$user['name'],
            'role' => (string)$user['role'],
            'isManager' => (bool)$user['is_manager'],
        ],
    ];
}

function reset_user_password(PDO $pdo, string $name, string $id, string $newPassword): array
{
    $name = trim($name);
    $id = trim($id);

    if ($name === '' || $id === '' || mb_strlen($newPassword) < 8) {
        return ['ok' => false, 'status' => 400, 'message' => '入力内容が不足しているか、パスワードが8文字未満です。'];
    }

    $stmt = $pdo->prepare('SELECT id FROM users WHERE id = ? AND name = ? LIMIT 1');
    $stmt->execute([$id, $name]);
    if (!$stmt->fetch()) {
        return ['ok' => false, 'status' => 404, 'message' => '入力したお名前とIDに一致するアカウントはありません。'];
    }

    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $upd = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $upd->execute([$newHash, $id]);

    return ['ok' => true, 'status' => 200, 'message' => 'パスワードを変更しました。'];
}

function change_user_password(PDO $pdo, string $userId, string $currentPass, string $newPass): array
{
    if ($currentPass === '' || mb_strlen($newPass) < 8) {
        return ['ok' => false, 'status' => 400, 'message' => '新しいパスワードは8文字以上で入力してください。'];
    }

    $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($currentPass, (string)$row['password_hash'])) {
        return ['ok' => false, 'status' => 401, 'message' => '現在のパスワードが間違っています。'];
    }
    if ($currentPass === $newPass) {
        return ['ok' => false, 'status' => 400, 'message' => '新しいパスワードは現在のパスワードと同じにできません。'];
    }

    $newHash = password_hash($newPass, PASSWORD_DEFAULT);
    $upd = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $upd->execute([$newHash, $userId]);

    return ['ok' => true, 'status' => 200, 'message' => 'パスワードを変更しました。'];
}

function toggle_general_manager_role(PDO $pdo, string $targetId): array
{
    $targetId = trim($targetId);
    $stmt = $pdo->prepare('SELECT id, name, role, is_manager FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetId]);
    $target = $stmt->fetch();

    if (!$target) {
        return ['ok' => false, 'status' => 404, 'message' => '対象ユーザーが見つかりません。'];
    }
    if ($target['role'] !== 'general') {
        return ['ok' => false, 'status' => 400, 'message' => '一般ユーザーのみ管理権限を切り替えられます。'];
    }

    $nextFlag = $target['is_manager'] ? 0 : 1;
    $upd = $pdo->prepare('UPDATE users SET is_manager = ? WHERE id = ?');
    $upd->execute([$nextFlag, $targetId]);

    return [
        'ok' => true,
        'status' => 200,
        'target' => [
            'id' => (string)$target['id'],
            'name' => (string)$target['name'],
            'role' => (string)$target['role'],
            'isManager' => (bool)$nextFlag,
        ],
        'users' => fetch_safe_users($pdo),
    ];
}

function delete_managed_user(PDO $pdo, array $actor, string $targetId, string $dbname): array
{
    $targetId = trim($targetId);
    $stmt = $pdo->prepare('SELECT id, name, role FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetId]);
    $target = $stmt->fetch();

    if (!$target) {
        return ['ok' => false, 'status' => 404, 'message' => '対象ユーザーが見つかりません。'];
    }
    if (!can_manage_target((string)$actor['role'], (string)$actor['id'], $target)) {
        return ['ok' => false, 'status' => 403, 'message' => 'この対象ユーザーを削除する権限がありません。'];
    }

    $del = $pdo->prepare('DELETE FROM users WHERE id = ?');
    $del->execute([$targetId]);

    $isProd = function_exists('is_production_env')
        ? is_production_env()
        : (strtolower(trim((string)(getenv('APP_ENV') ?: ($_ENV['APP_ENV'] ?? 'production')))) === 'production');

    $databaseDropped = $isProd
        ? false
        : drop_database_if_users_empty($pdo, $dbname);

    return [
        'ok' => true,
        'status' => 200,
        'deleted' => $target,
        'databaseDropped' => $databaseDropped,
        'users' => $databaseDropped ? [] : fetch_safe_users($pdo),
    ];
}

function authorize_force_logout_target(PDO $pdo, array $actor, string $targetId): array
{
    $targetId = trim($targetId);
    $stmt = $pdo->prepare('SELECT id, name, role FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([$targetId]);
    $target = $stmt->fetch();

    if (!$target || !can_manage_target((string)$actor['role'], (string)$actor['id'], $target)) {
        return ['ok' => false, 'status' => 403, 'message' => '対象ユーザーを強制ログアウトできません。'];
    }

    return [
        'ok' => true,
        'status' => 200,
        'targetId' => (string)$target['id'],
        'targetName' => (string)$target['name'],
    ];
}