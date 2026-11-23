<?php
// tests/AuthManagementTest.php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../src/AuthManagement.php';

final class AuthManagementTest extends TestCase
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

    public function testAuthenticateUserAndRecordLoginHistory(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        $hash = password_hash('SecretPass123!', PASSWORD_DEFAULT);
        $stmt = $pdo->prepare(
            'INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute(['u_general', '一般ユーザー', $hash, 'general', 0]);

        // 誤ったパスワードは null
        $this->assertNull(authenticate_user($pdo, 'u_general', 'WrongPass'));

        // 正しいパスワードはユーザー情報を返す
        $user = authenticate_user($pdo, 'u_general', 'SecretPass123!');
        $this->assertNotNull($user);
        $this->assertSame('u_general', $user['id']);
        $this->assertSame('一般ユーザー', $user['name']);
        $this->assertSame('general', $user['role']);
        $this->assertFalse($user['isManager']);
        $this->assertArrayNotHasKey('password_hash', $user);

        // ログイン履歴の記録確認
        record_login_history($pdo, $user['name'], $user['id'], 'ok', '2026-11-23 09:46:00');
        $logs = $pdo->query('SELECT name, id, password, time FROM logintable')->fetchAll();
        $this->assertCount(1, $logs);
        $this->assertSame('一般ユーザー', $logs[0]['name']);
        $this->assertSame('u_general', $logs[0]['id']);
        $this->assertSame('2026-11-23 09:46:00', $logs[0]['time']);
    }

    public function testChangeUserRoleRespectsPermissionsAndRejectsInvalidRole(): void
    {
        $pdo = $this->prepareTestDbOrSkip();

        $hash = password_hash('Password123', PASSWORD_DEFAULT);
        $stmt = $pdo->prepare(
            'INSERT INTO users (id, name, password_hash, role, is_manager) VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute(['m1', 'マスター', $hash, 'master', 1]);
        $stmt->execute(['s1', 'サブマスター', $hash, 'submaster', 1]);
        $stmt->execute(['g1', '一般1', $hash, 'general', 0]);

        // submaster は他の submaster を昇格・変更できない（権限エラー相当で false）
        $this->assertFalse(change_user_role($pdo, 'submaster', 's1', 's1', 'general'));
        $this->assertFalse(change_user_role($pdo, 'submaster', 's1', 'm1', 'general'));

        // master は general を submaster へ更新できる
        $this->assertTrue(change_user_role($pdo, 'master', 'm1', 'g1', 'submaster', true));

        $check = $pdo->prepare('SELECT role, is_manager FROM users WHERE id = ?');
        $check->execute(['g1']);
        $updated = $check->fetch();
        $this->assertSame('submaster', $updated['role']);
        $this->assertSame(1, (int)$updated['is_manager']);

        // 不正なロール名は例外
        $this->expectException(InvalidArgumentException::class);
        change_user_role($pdo, 'master', 'm1', 'g1', 'superuser');
    }
}