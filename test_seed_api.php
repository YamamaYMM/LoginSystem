<?php
// test_seed_api.php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

start_secure_session();
header('Content-Type: application/json; charset=utf-8');

$appEnv = strtolower((string)(getenv('APP_ENV') ?: ''));
$remoteAddr = (string)($_SERVER['REMOTE_ADDR'] ?? '');
if (!in_array($appEnv, ['local', 'test'], true)
    || !in_array($remoteAddr, ['127.0.0.1', '::1'], true)) {
    json_response(403, ['status' => 'error', 'message' => 'この操作はローカル/テスト環境でのみ利用できます。']);
}

$input = read_json_input();
verify_csrf_token($input);

$action = (string)($input['action'] ?? '');

try {
    if ($action === 'seed_test_users') {
        $usersToSeed = $input['users'] ?? [];
        if (!is_array($usersToSeed) || count($usersToSeed) === 0) {
            json_response(400, ['status' => 'error', 'message' => 'users 配列が必要です。']);
        }

        $preparedUsers = [];
        foreach ($usersToSeed as $u) {
            if (!is_array($u)) {
                continue;
            }
            $uid = trim((string)($u['id'] ?? ''));
            $uname = trim((string)($u['name'] ?? ''));
            $upass = (string)($u['password'] ?? '');
            $urole = (string)($u['role'] ?? 'general');

            if ($uid === '' || $uname === '' || mb_strlen($upass) < 8) {
                continue;
            }
            if (!in_array($urole, ['master', 'submaster', 'general'], true)) {
                $urole = 'general';
            }
            $preparedUsers[] = [
                $uid,
                $uname,
                password_hash($upass, PASSWORD_DEFAULT),
                $urole,
                in_array($urole, ['master', 'submaster'], true) ? 1 : 0,
            ];
        }

        if (count($preparedUsers) === 0) {
            json_response(400, ['status' => 'error', 'message' => '有効なテストユーザーがありません。']);
        }

        $cfg = load_db_config();
        init_db_and_tables_from_credentials($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['dbname']);
        $pdo = get_pdo(true);

        $delStmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
        $insStmt = $pdo->prepare(
            'INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, ?)'
        );

        try {
            $pdo->beginTransaction();
            foreach ($preparedUsers as $userRow) {
                $delStmt->execute([$userRow[0]]);
                $insStmt->execute($userRow);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        json_response(200, ['status' => 'success', 'message' => 'テストユーザーを再シードしました。']);
    }

    if ($action === 'cleanup_test_users') {
        $ids = $input['ids'] ?? [];
        if (!is_array($ids) || count($ids) === 0) {
            json_response(400, ['status' => 'error', 'message' => 'ids 配列が必要です。']);
        }

        $cleanIds = [];
        foreach ($ids as $id) {
            $uid = trim((string)$id);
            if ($uid !== '') {
                $cleanIds[] = $uid;
            }
        }
        $cleanIds = array_values(array_unique($cleanIds));

        if (count($cleanIds) === 0) {
            json_response(400, ['status' => 'error', 'message' => '有効なIDがありません。']);
        }

        $pdo = get_pdo(true);
        $placeholders = implode(',', array_fill(0, count($cleanIds), '?'));
        $stmt = $pdo->prepare("DELETE FROM users WHERE id IN ({$placeholders})");
        $stmt->execute($cleanIds);
        $databaseDropped = drop_database_if_users_empty($pdo, get_configured_dbname());

        json_response(200, [
            'status' => 'success',
            'deletedCount' => $stmt->rowCount(),
            'databaseDropped' => $databaseDropped,
            'message' => 'テストユーザーを削除しました。',
        ]);
    }

    json_response(400, ['status' => 'error', 'message' => '未対応のテストアクションです。']);
} catch (Throwable $e) {
    $isLocal = in_array(strtolower((string)(getenv('APP_ENV') ?: '')), ['local', 'test'], true);
    json_response(500, [
        'status' => 'error',
        'message' => $isLocal
            ? 'サーバーエラーが発生しました: ' . $e->getMessage()
            : 'サーバーエラーが発生しました。',
    ]);
}