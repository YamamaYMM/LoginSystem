<?php
// tests/BootstrapAndAuthTest.php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../src/AuthHelpers.php';

final class BootstrapAndAuthTest extends TestCase
{
    private array $originalEnv = [];
    private string $testDbName = 'logindatabase_test';

    protected function setUp(): void
    {
        parent::setUp();

        // テスト前の環境変数を退避
        foreach (['APP_ENV', 'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'] as $key) {
            $this->originalEnv[$key] = getenv($key);
        }

        putenv('APP_ENV=test');
        putenv("DB_NAME={$this->testDbName}");
    }

    protected function tearDown(): void
    {
        // 環境変数を復元
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

    // ---------------------------------------------------------
    // 1. bootstrap.php: 設定読み込み・バリデーションの単体テスト
    // ---------------------------------------------------------

    public function testLoadDbConfigReadsEnvironmentVariables(): void
    {
        putenv('DB_HOST=127.0.0.1');
        putenv('DB_USER=test_user');
        putenv('DB_PASS=secret_pass');
        putenv('DB_NAME=logindatabase_test');

        $cfg = load_db_config();

        $this->assertSame('127.0.0.1', $cfg['host']);
        $this->assertSame('test_user', $cfg['user']);
        $this->assertSame('secret_pass', $cfg['pass']);
        $this->assertSame('logindatabase_test', $cfg['dbname']);
        $this->assertSame('logindatabase_test', get_configured_dbname());
    }

    public function testLoadDbConfigRejectsInvalidDatabaseName(): void
    {
        putenv('DB_NAME=invalid-db-name!');

        $this->expectException(InvalidArgumentException::class);
        load_db_config();
    }

    public function testLoadDbConfigRequiresCredentialsInProduction(): void
    {
        putenv('APP_ENV=production');
        putenv('DB_HOST=');
        putenv('DB_USER=');

        // db_config.php が存在する環境ではフォールバックされる可能性があるため、
        // フォールバック先も空である前提のときのみ検証
        $cfgFile = __DIR__ . '/../db_config.php';
        if (file_exists($cfgFile)) {
            $fileCfg = require $cfgFile;
            if (!empty($fileCfg['host']) && !empty($fileCfg['user'])) {
                $this->markTestSkipped('db_config.php にフォールバック設定が存在するためスキップします。');
            }
        }

        $this->expectException(RuntimeException::class);
        load_db_config();
    }

    // ---------------------------------------------------------
    // 2. auth_api.php (AuthHelpers): 権限判定の単体テスト
    // ---------------------------------------------------------

    public function testCanManageTargetRules(): void
    {
        // 自分自身は操作不可
        $this->assertFalse(can_manage_target('master', 'm1', ['id' => 'm1', 'role' => 'general']));

        // master は他の master 以外を操作可能
        $this->assertFalse(can_manage_target('master', 'm1', ['id' => 'm2', 'role' => 'master']));
        $this->assertTrue(can_manage_target('master', 'm1', ['id' => 's1', 'role' => 'submaster']));
        $this->assertTrue(can_manage_target('master', 'm1', ['id' => 'u1', 'role' => 'general']));

        // submaster は general のみ操作可能
        $this->assertFalse(can_manage_target('submaster', 's1', ['id' => 'm1', 'role' => 'master']));
        $this->assertFalse(can_manage_target('submaster', 's1', ['id' => 's2', 'role' => 'submaster']));
        $this->assertTrue(can_manage_target('submaster', 's1', ['id' => 'u1', 'role' => 'general']));

        // general は誰も操作不可
        $this->assertFalse(can_manage_target('general', 'u1', ['id' => 'u2', 'role' => 'general']));

        // 対象IDが空の場合は不可
        $this->assertFalse(can_manage_target('master', 'm1', ['id' => '', 'role' => 'general']));
    }

    // ---------------------------------------------------------
    // 3. MySQL テスト用DB（logindatabase_test）を使った結合単体テスト
    // ---------------------------------------------------------

    private function connectTestDbOrSkip(): PDO
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

    public function testInitDatabaseTablesFetchUsersAndDropWhenEmpty(): void
    {
        $pdo = $this->connectTestDbOrSkip();

        // 1. users と logintable が作成されていること
        $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
        $this->assertContains('users', $tables);
        $this->assertContains('logintable', $tables);

        // 2. ユーザー追加後に fetch_safe_users でパスワードハッシュが含まれないこと
        $stmt = $pdo->prepare(
            "INSERT INTO users (id, name, password_hash, role, is_manager, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute(['master001', '管理者太郎', password_hash('Password123', PASSWORD_DEFAULT), 'master', 0, '2026-01-01 00:00:01']);
        $stmt->execute(['general01', '一般花子', password_hash('Password123', PASSWORD_DEFAULT), 'general', 1, '2026-01-01 00:00:02']);

        $users = fetch_safe_users($pdo);
        $this->assertCount(2, $users);
        $this->assertSame('master001', $users[0]['id']);
        $this->assertFalse($users[0]['isManager']);
        $this->assertArrayNotHasKey('password_hash', $users[0]);
        $this->assertTrue($users[1]['isManager']);

        // 3. ユーザーが残っている間は DB が削除されないこと
        $this->assertFalse(drop_database_if_users_empty($pdo, $this->testDbName));

        // 4. 全ユーザー削除後は DB が自動削除されること
        $pdo->exec("DELETE FROM users");
        $this->assertTrue(drop_database_if_users_empty($pdo, $this->testDbName));

        // 削除されたことを INFORMATION_SCHEMA で確認
        $checkStmt = $pdo->prepare(
            "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1"
        );
        $checkStmt->execute([$this->testDbName]);
        $this->assertFalse($checkStmt->fetch());
    }
}