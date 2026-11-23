<?php
// tests/AuthHelpersEdgeCaseTest.php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../src/AuthHelpers.php';

final class AuthHelpersEdgeCaseTest extends TestCase
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

    public function testCanManageTargetRejectsUnknownRolesAndMalformedTarget(): void
    {
        // 未知のアクターロールは拒否
        $this->assertFalse(can_manage_target('guest', 'g1', ['id' => 'u1', 'role' => 'general']));
        $this->assertFalse(can_manage_target('', 'g1', ['id' => 'u1', 'role' => 'general']));
        $this->assertFalse(can_manage_target('MASTER', 'm1', ['id' => 'u1', 'role' => 'general']));

        // ターゲット配列の欠損・異常値
        $this->assertFalse(can_manage_target('master', 'm1', []));
        $this->assertFalse(can_manage_target('master', 'm1', ['role' => 'general']));
        $this->assertTrue(can_manage_target('master', 'm1', ['id' => '0', 'role' => 'general']));    }

    public function testFetchSafeUsersReturnsEmptyArrayWhenNoUsers(): void
    {
        $pdo = $this->createFreshTestDbOrSkip();
        $pdo->exec("DELETE FROM users");

        $this->assertSame([], fetch_safe_users($pdo));
    }

    public function testFetchSafeUsersTieBreaksSameCreatedAtByIdAsc(): void
    {
        $pdo = $this->createFreshTestDbOrSkip();

        $sameTime = '2026-11-23 09:00:00';
        $hash = password_hash('Password123', PASSWORD_DEFAULT);

        $stmt = $pdo->prepare(
            "INSERT INTO users (id, name, password_hash, role, is_manager, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute(['user_b', 'ユーザーB', $hash, 'general', 0, $sameTime]);
        $stmt->execute(['user_a', 'ユーザーA', $hash, 'general', 1, $sameTime]);

        $users = fetch_safe_users($pdo);

        $this->assertCount(2, $users);
        $this->assertSame(['user_a', 'user_b'], array_column($users, 'id'));
        $this->assertTrue($users[0]['isManager']);
        $this->assertFalse($users[1]['isManager']);
        foreach ($users as $user) {
            $this->assertArrayNotHasKey('password_hash', $user);
        }
    }

    public function testDuplicateUserIdThrowsPdoException(): void
    {
        $pdo = $this->createFreshTestDbOrSkip();
        $hash = password_hash('Password123', PASSWORD_DEFAULT);

        $stmt = $pdo->prepare(
            "INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, ?)"
        );
        $stmt->execute(['dup01', '重複テスト1', $hash, 'general', 0]);

        $this->expectException(PDOException::class);
        $stmt->execute(['dup01', '重複テスト2', $hash, 'general', 0]);
    }

    private function createFreshTestDbOrSkip(): PDO
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
}