<?php
// tests/BootstrapDatabaseTest.php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../bootstrap.php';

final class BootstrapDatabaseTest extends TestCase
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

    public function testCreateBasePdoRejectsInvalidDatabaseName(): void
    {
        $this->expectException(InvalidArgumentException::class);
        create_base_pdo('127.0.0.1', 'root', '', 'invalid-db-name');
    }

    public function testInitDbAndTablesFromCredentialsRejectsInvalidDatabaseName(): void
    {
        $this->expectException(InvalidArgumentException::class);
        init_db_and_tables_from_credentials('127.0.0.1', 'root', '', 'invalid.db');
    }

    public function testDropDatabaseIfUsersEmptyRejectsInvalidDatabaseName(): void
    {
        $cfg = load_db_config();
        if ($cfg['host'] === '' || $cfg['user'] === '') {
            $this->markTestSkipped('MySQL テスト接続用の DB_HOST / DB_USER が未設定です。');
        }

        try {
            $pdo = create_base_pdo($cfg['host'], $cfg['user'], $cfg['pass'], null);
        } catch (PDOException $e) {
            $this->markTestSkipped('MySQL サーバーへ接続できないためテストをスキップします: ' . $e->getMessage());
        }

        $this->expectException(InvalidArgumentException::class);
        drop_database_if_users_empty($pdo, 'invalid-db-name');
    }

    public function testInitDbAndTablesIsIdempotentAndPreservesDbWhenUsersExist(): void
    {
        $cfg = load_db_config();
        if ($cfg['host'] === '' || $cfg['user'] === '') {
            $this->markTestSkipped('MySQL テスト接続用の DB_HOST / DB_USER が未設定です。');
        }

        try {
            $serverPdo = create_base_pdo($cfg['host'], $cfg['user'], $cfg['pass'], null);
            $serverPdo->exec("DROP DATABASE IF EXISTS `{$this->testDbName}`");

            // 1回目の初期化
            $pdoFirst = init_db_and_tables_from_credentials(
                $cfg['host'],
                $cfg['user'],
                $cfg['pass'],
                $this->testDbName
            );

            $stmt = $pdoFirst->prepare(
                "INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, ?)"
            );
            $stmt->execute([
                'keep01',
                '維持ユーザー',
                password_hash('Password123', PASSWORD_DEFAULT),
                'general',
                0,
            ]);

            // 2回目の初期化（冪等性：エラーにならず既存データ・テーブルを維持）
            $pdoSecond = init_db_and_tables_from_credentials(
                $cfg['host'],
                $cfg['user'],
                $cfg['pass'],
                $this->testDbName
            );

            $tables = $pdoSecond->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
            $this->assertContains('users', $tables);
            $this->assertContains('logintable', $tables);

            $count = (int)$pdoSecond->query("SELECT COUNT(*) FROM users")->fetchColumn();
            $this->assertSame(1, $count);

            // ユーザーが存在する間は DB を削除しない
            $this->assertFalse(drop_database_if_users_empty($pdoSecond, $this->testDbName));

            // 後片付け：削除してテストDBをクリーンな状態に戻す
            $pdoSecond->exec("DELETE FROM users");
            $this->assertTrue(drop_database_if_users_empty($pdoSecond, $this->testDbName));
        } catch (PDOException $e) {
            $this->markTestSkipped('MySQL サーバーへ接続できないため DB テストをスキップします: ' . $e->getMessage());
        }
    }
}