<?php
// tests/AuthActionsBoundaryTest.php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../src/AuthActions.php';

final class AuthActionsBoundaryTest extends TestCase
{
    private string $testDbName = 'logindatabase_test';

    private function prepareTestDbOrSkip(): PDO
    {
        $cfg = load_db_config();
        if ($cfg['host'] === '' || $cfg['user'] === '') {
            $this->markTestSkipped('MySQL テスト接続用の DB_HOST / DB_USER が未設定です。');
        }

        try {
            $serverPdo = create_base_pdo($cfg['host'], $cfg['user'], $cfg['pass'], null);
            $serverPdo->exec("DROP DATABASE IF EXISTS `{$this->testDbName}`");
            return init_db_and_tables_from_credentials(
                $cfg['host'],
                $cfg['user'],
                $cfg['pass'],
                $this->testDbName
            );
        } catch (PDOException $e) {
            $this->markTestSkipped('MySQL サーバーへ接続できないため DB テストをスキップします: ' . $e->getMessage());
        }
    }

    public function testSubmasterLimitRejectsFifthRegistrationWith409(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        for ($i = 1; $i <= 4; $i++) {
            $res = register_user_account($pdo, [
                'name' => "サブマス{$i}",
                'id' => "submaster_0{$i}",
                'password' => 'Password123',
                'role' => 'submaster',
            ]);
            $this->assertTrue($res['ok']);
            $this->assertSame(201, $res['status']);
        }

        $fifth = register_user_account($pdo, [
            'name' => 'サブマス5',
            'id' => 'submaster_05',
            'password' => 'Password123',
            'role' => 'submaster',
        ]);
        $this->assertFalse($fifth['ok']);
        $this->assertSame(409, $fifth['status']);
    }

    public function testResetUserPasswordValidationAndUpdate(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        register_user_account($pdo, [
            'name' => 'リセット対象',
            'id' => 'reset_user_01',
            'password' => 'OldPass123',
            'role' => 'general',
        ]);

        // 8文字未満は 400
        $shortRes = reset_user_password($pdo, 'リセット対象', 'reset_user_01', '1234567');
        $this->assertFalse($shortRes['ok']);
        $this->assertSame(400, $shortRes['status']);

        // 名前不一致は 404
        $notFoundRes = reset_user_password($pdo, '別名ユーザー', 'reset_user_01', 'NewPass123');
        $this->assertFalse($notFoundRes['ok']);
        $this->assertSame(404, $notFoundRes['status']);

        // 正常再設定
        $okRes = reset_user_password($pdo, 'リセット対象', 'reset_user_01', 'NewPass123');
        $this->assertTrue($okRes['ok']);
        $this->assertSame(200, $okRes['status']);

        $this->assertFalse(verify_login_credentials($pdo, 'リセット対象', 'reset_user_01', 'OldPass123')['ok']);
        $this->assertTrue(verify_login_credentials($pdo, 'リセット対象', 'reset_user_01', 'NewPass123')['ok']);
    }

    public function testChangeUserPasswordBoundaryAndErrors(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        register_user_account($pdo, [
            'name' => 'パス変更ユーザー',
            'id' => 'chg_user_01',
            'password' => 'InitPass123',
            'role' => 'general',
        ]);

        // 新パスワードが8文字未満 -> 400
        $shortNew = change_user_password($pdo, 'chg_user_01', 'InitPass123', 'Short1');
        $this->assertFalse($shortNew['ok']);
        $this->assertSame(400, $shortNew['status']);

        // 現パスワード誤り -> 401
        $wrongCurrent = change_user_password($pdo, 'chg_user_01', 'WrongPass123', 'NextPass123');
        $this->assertFalse($wrongCurrent['ok']);
        $this->assertSame(401, $wrongCurrent['status']);

        // 現パスワードと同一 -> 400
        $samePass = change_user_password($pdo, 'chg_user_01', 'InitPass123', 'InitPass123');
        $this->assertFalse($samePass['ok']);
        $this->assertSame(400, $samePass['status']);

        // 正常変更
        $okChange = change_user_password($pdo, 'chg_user_01', 'InitPass123', 'NextPass123');
        $this->assertTrue($okChange['ok']);
        $this->assertSame(200, $okChange['status']);
    }

    public function testDeleteManagedUserDropsDatabaseWhenLastUserDeleted(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        register_user_account($pdo, [
            'name' => 'マスター',
            'id' => 'master_01',
            'password' => 'Password123',
            'role' => 'master',
        ]);
        register_user_account($pdo, [
            'name' => 'サブマス',
            'id' => 'submaster_01',
            'password' => 'Password123',
            'role' => 'submaster',
        ]);

        // 1. master が submaster_01 を削除（users に master_01 の1人だけ残る）[cite: 2, 3]
        $delSubmaster = delete_managed_user(
            $pdo,
            ['id' => 'master_01', 'role' => 'master'],
            'submaster_01',
            $this->testDbName
        );
        $this->assertTrue($delSubmaster['ok']);
        $this->assertFalse($delSubmaster['databaseDropped']);

        // 2. 最後の 1 ユーザー（master_01）を削除して空になったとき DB が削除されるか確認[cite: 2]
        // ※ delete_managed_user() は自己削除を拒否するため、drop_database_if_users_empty() で検証[cite: 2, 3]
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute(['master_01']);
        $dropped = drop_database_if_users_empty($pdo, $this->testDbName);
        $this->assertTrue($dropped);

        // データベースが存在しないことを確認[cite: 2]
        $checkStmt = $pdo->prepare(
            'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1'
        );
        $checkStmt->execute([$this->testDbName]);
        $this->assertFalse($checkStmt->fetch());
    }
}