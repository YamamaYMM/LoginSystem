<?php
// tests/AuthActionsTest.php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../src/AuthActions.php';

final class AuthActionsTest extends TestCase
{
    private array $originalEnv = [];
    private string $testDbName = 'logindatabase_test';

    protected function setUp(): void
    {
        parent::setUp();

        foreach (['APP_ENV', 'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'] as $key) {
            $this->originalEnv[$key] = getenv($key);
        }

        putenv('APP_ENV=test');
        putenv("DB_NAME={$this->testDbName}");
    }

    protected function tearDown(): void
    {
        foreach ($this->originalEnv as $key => $val) {
            if ($val === false) {
                putenv($key);
                unset($_ENV[$key]);
            } else {
                putenv("{$key}={$val}");
                $_ENV[$key] = $val;
            }
        }

        parent::tearDown();
    }

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

    public function testRegisterAndLoginFlowWithLimitsAndErrors(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        // 1人目の master は登録可能
        $res1 = register_user_account($pdo, [
            'name' => 'マスター太郎',
            'id' => 'master_01',
            'password' => 'Password123',
            'role' => 'master',
        ]);
        $this->assertTrue($res1['ok']);
        $this->assertSame(201, $res1['status']);

        // 2人目の master は 409 で拒否
        $resDupMaster = register_user_account($pdo, [
            'name' => 'マスター二郎',
            'id' => 'master_02',
            'password' => 'Password123',
            'role' => 'master',
        ]);
        $this->assertFalse($resDupMaster['ok']);
        $this->assertSame(409, $resDupMaster['status']);

        // パスワード不一致は 401
        $badPass = verify_login_credentials($pdo, 'マスター太郎', 'master_01', 'WrongPass123');
        $this->assertFalse($badPass['ok']);
        $this->assertSame(401, $badPass['status']);

        // 名前不一致は 401
        $badName = verify_login_credentials($pdo, '別名ユーザー', 'master_01', 'Password123');
        $this->assertFalse($badName['ok']);
        $this->assertSame(401, $badName['status']);

        // 一致時は 200 でユーザー情報を返す
        $okLogin = verify_login_credentials($pdo, 'マスター太郎', 'master_01', 'Password123');
        $this->assertTrue($okLogin['ok']);
        $this->assertSame(200, $okLogin['status']);
        $this->assertSame('master_01', $okLogin['user']['id']);
    }

    public function testToggleManagerRoleAndDeleteUserPermissions(): void
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
            'id' => 'submas_01',
            'password' => 'Password123',
            'role' => 'submaster',
        ]);
        register_user_account($pdo, [
            'name' => '一般ユーザー',
            'id' => 'general_01',
            'password' => 'Password123',
            'role' => 'general',
        ]);

        // general 以外の管理権限切替は 400
        $invalidToggle = toggle_general_manager_role($pdo, 'submas_01');
        $this->assertFalse($invalidToggle['ok']);
        $this->assertSame(400, $invalidToggle['status']);

        // general の管理権限切替は 200 で反転
        $okToggle = toggle_general_manager_role($pdo, 'general_01');
        $this->assertTrue($okToggle['ok']);
        $this->assertTrue($okToggle['target']['isManager']);

        // submaster が master を削除しようとすると 403
        $forbiddenDelete = delete_managed_user(
            $pdo,
            ['id' => 'submas_01', 'role' => 'submaster'],
            'master_01',
            $this->testDbName
        );
        $this->assertFalse($forbiddenDelete['ok']);
        $this->assertSame(403, $forbiddenDelete['status']);
    }
}