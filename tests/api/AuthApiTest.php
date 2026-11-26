<?php
declare(strict_types=1);

/**
 * 実行例:
 *   APP_BASE_URL=http://localhost/LoginSystem php tests/api/AuthApiTest.php
 */

$baseUrl = rtrim(getenv('APP_BASE_URL') ?: 'http://localhost/LoginSystem', '/');
$apiUrl = $baseUrl . '/auth_api.php';
$dbApiUrl = $baseUrl . '/LoginDatabase.php';

class ApiTestRunner
{
    private string $apiUrl;
    private string $cookieHeader = '';
    private int $passed = 0;
    private int $failed = 0;

    public function __construct(string $apiUrl)
    {
        $this->apiUrl = $apiUrl;
    }

    public function resetSession(): void
    {
        $this->cookieHeader = '';
    }

    /**
     * @param array<string, mixed> $payload
     * @param array<string, string> $headers
     * @return array{status: int, body: array<string, mixed>|null, raw: string}
     */
    public function post(array $payload, array $headers = [], ?string $endpointUrl = null): array
    {
        $targetUrl = $endpointUrl ?? $this->apiUrl;
        $jsonBody = json_encode($payload, JSON_UNESCAPED_UNICODE);

        $headerLines = [
            'Content-Type: application/json',
            'Accept: application/json',
            'Connection: close',
        ];
        if ($this->cookieHeader !== '') {
            $headerLines[] = 'Cookie: ' . $this->cookieHeader;
        }
        foreach ($headers as $header) {
            $headerLines[] = $header;
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", $headerLines) . "\r\n",
                'content' => $jsonBody,
                'ignore_errors' => true,
                'timeout' => 15,
            ],
        ]);

        $raw = @file_get_contents($targetUrl, false, $context);
        if ($raw === false) {
            $err = error_get_last()['message'] ?? 'stream request failed';
            throw new RuntimeException('HTTP request error: ' . $err);
        }

        $status = 0;
        $cookies = [];
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\\S+\\s+(\\d{3})#', $line, $matches)) {
                $status = (int) $matches[1];
            } elseif (preg_match('/^Set-Cookie:\\s*([^;]+)/i', $line, $matches)) {
                $pair = trim($matches[1]);
                [$name] = explode('=', $pair, 2);
                $cookies[$name] = $pair;
            }
        }
        if ($cookies !== []) {
            $this->cookieHeader = implode('; ', $cookies);
        }

        $decoded = json_decode((string) $raw, true);
        return [
            'status' => $status,
            'body' => is_array($decoded) ? $decoded : null,
            'raw' => (string) $raw,
        ];
    }

    public function fetchCsrfToken(): string
    {
        $res = $this->post(['action' => 'session_status']);
        $this->assertEquals(200, $res['status'], 'session_status should return 200');
        $token = $res['body']['csrfToken'] ?? '';
        $this->assertTrue(is_string($token) && $token !== '', 'csrfToken should be returned');
        return (string) $token;
    }

    public function registerGeneral(string $name, string $id, string $password): void
    {
        $token = $this->fetchCsrfToken();
        $res = $this->post(
            [
                'action' => 'register_user',
                'name' => $name,
                'id' => $id,
                'password' => $password,
                'role' => 'general',
                'csrf_token' => $token,
            ],
            ["X-CSRF-Token: {$token}"]
        );
        $this->assertEquals(201, $res['status'], 'register_user should return 201');
    }

    public function ensureMaster(string $name, string $id, string $password): bool
    {
        $token = $this->fetchCsrfToken();
        $res = $this->post(
            [
                'action' => 'register_user',
                'name' => $name,
                'id' => $id,
                'password' => $password,
                'role' => 'master',
                'csrf_token' => $token,
            ],
            ["X-CSRF-Token: {$token}"]
        );
        $this->assertTrue(
            in_array($res['status'], [201, 409], true),
            'register_user(master) should return 201 or 409'
        );

        return $res['status'] === 201;
    }

    public function login(string $name, string $id, string $password): string
    {
        $res = $this->post([
            'action' => 'login_session',
            'name' => $name,
            'id' => $id,
            'password' => $password,
        ]);
        $msg = is_array($res['body'] ?? null) ? (string) ($res['body']['message'] ?? '') : '';
        $this->assertEquals(
            200,
            $res['status'],
            "login_session should return 200 (message={$msg}, raw={$res['raw']})"
        );
        $token = $res['body']['csrfToken'] ?? '';
        $this->assertTrue(is_string($token) && $token !== '', 'csrfToken should be returned on login');
        return (string) $token;
    }

    public function deleteSelf(string $name, string $id, string $password): void
    {
        $this->resetSession();
        $token = $this->login($name, $id, $password);
        $this->post(
            ['action' => 'delete_self', 'csrf_token' => $token],
            ["X-CSRF-Token: {$token}"]
        );
        $this->resetSession();
    }

    public function assertEquals($expected, $actual, string $message): void
    {
        if ($expected !== $actual) {
            throw new AssertionError(
                sprintf('%s | expected: %s, actual: %s', $message, var_export($expected, true), var_export($actual, true))
            );
        }
    }

    public function assertTrue(bool $condition, string $message): void
    {
        if (!$condition) {
            throw new AssertionError($message);
        }
    }

    public function run(string $name, callable $testFn): void
    {
        $this->resetSession();
        try {
            $testFn($this);
            $this->passed++;
            echo "[PASS] {$name}\n";
        } catch (Throwable $e) {
            $this->failed++;
            echo "[FAIL] {$name}: {$e->getMessage()}\n";
        }
    }

    public function summary(): int
    {
        echo "\nResult: {$this->passed} passed, {$this->failed} failed\n";
        return $this->failed === 0 ? 0 : 1;
    }
}

$runner = new ApiTestRunner($apiUrl);

// 1. CSRF 検証
$runner->run('CSRFトークン欠落・不正時は403を返す', function (ApiTestRunner $t) {
    $resNoToken = $t->post([
        'action' => 'register_user',
        'name' => 'CSRF検証ユーザー',
        'id' => 'csrf_test_0001',
        'password' => 'Str0ng!Pass#2026',
        'role' => 'general',
    ]);
    $t->assertEquals(403, $resNoToken['status'], 'Missing CSRF token should return 403');

    $resInvalidToken = $t->post(
        [
            'action' => 'register_user',
            'name' => 'CSRF検証ユーザー',
            'id' => 'csrf_test_0001',
            'password' => 'Str0ng!Pass#2026',
            'role' => 'general',
        ],
        ['X-CSRF-Token: invalid-token-value']
    );
    $t->assertEquals(403, $resInvalidToken['status'], 'Invalid CSRF token should return 403');
});

// 2. 重複ユーザー登録拒否（409）
$runner->run('重複ユーザーIDの登録は409で拒否される', function (ApiTestRunner $t) {
    $suffix = substr((string) microtime(true), -6) . '_' . random_int(100, 999);
    $masterName = "APIマスター_{$suffix}";
    $masterId = "api_master_{$suffix}";
    $password = 'Str0ng!Pass#2026';
    $createdMaster = $t->ensureMaster($masterName, $masterId, $password);

    $userName = "重複検証_{$suffix}";
    $userId = "dup_api_{$suffix}";

    $t->registerGeneral($userName, $userId, $password);

    $token2 = $t->fetchCsrfToken();
    $dupRes = $t->post(
        [
            'action' => 'register_user',
            'name' => $userName,
            'id' => $userId,
            'password' => $password,
            'role' => 'general',
            'csrf_token' => $token2,
        ],
        ["X-CSRF-Token: {$token2}"]
    );
    $t->assertEquals(409, $dupRes['status'], 'Duplicate user registration should return 409');

    $t->deleteSelf($userName, $userId, $password);
    if ($createdMaster) {
        $t->deleteSelf($masterName, $masterId, $password);
    }
});

// 3. パスワード長・再設定バリデーション（400 / 404）
$runner->run('短すぎるパスワードは登録・再設定ともに400で拒否される', function (ApiTestRunner $t) {
    $suffix = substr((string) microtime(true), -6) . '_' . random_int(100, 999);
    $masterName = "APIマスター_{$suffix}";
    $masterId = "api_master_{$suffix}";
    $password = 'Str0ng!Pass#2026';
    $createdMaster = $t->ensureMaster($masterName, $masterId, $password);

    $token = $t->fetchCsrfToken();
    $regShort = $t->post(
        [
            'action' => 'register_user',
            'name' => '短パス検証',
            'id' => 'short_pass_user_01',
            'password' => '1234567',
            'role' => 'general',
            'csrf_token' => $token,
        ],
        ["X-CSRF-Token: {$token}"]
    );
    $t->assertEquals(400, $regShort['status'], 'Short password on register_user should return 400');

    $resetShort = $t->post(
        [
            'action' => 'reset_password',
            'name' => '短パス検証',
            'id' => 'short_pass_user_01',
            'newPassword' => '1234567',
            'csrf_token' => $token,
        ],
        ["X-CSRF-Token: {$token}"]
    );
    $t->assertEquals(400, $resetShort['status'], 'Short password on reset_password should return 400');

    if ($createdMaster) {
        $t->deleteSelf($masterName, $masterId, $password);
    }
});

// 4. ロール権限検証（未認証 401 / 一般ユーザーの管理者操作 403）
$runner->run('未認証は401、一般ユーザーの管理者操作は403を返す', function (ApiTestRunner $t) {
    $suffix = substr((string) microtime(true), -6) . '_' . random_int(100, 999);
    $masterName = "権限テストマスター_{$suffix}";
    $masterId = "auth_master_{$suffix}";
    $password = 'Str0ng!Pass#2026';

    // DBが存在しない状態を防ぐため先に初期化
    $createdMaster = $t->ensureMaster($masterName, $masterId, $password);

    // 新しいセッション（未認証）で list_users を確認
    $t->resetSession();
    $unauthRes = $t->post(['action' => 'list_users']);
    $t->assertEquals(401, $unauthRes['status'], 'Unauthenticated list_users should return 401');

    // 一般ユーザーでログインして管理者限定操作（403）を確認
    $userName = "権限テスト一般_{$suffix}";
    $userId = "auth_gen_{$suffix}";

    $t->registerGeneral($userName, $userId, $password);
    $token = $t->login($userName, $userId, $password);

    $adminRes = $t->post(
        [
            'action' => 'toggle_manager_role',
            'targetId' => $masterId,
            'csrf_token' => $token,
        ],
        ["X-CSRF-Token: {$token}"]
    );
    $t->assertEquals(403, $adminRes['status'], 'General user toggle_manager_role should return 403');

    // 後始末：一般ユーザーを削除し、必要ならマスターを再作成してから削除
    $t->post(
        ['action' => 'delete_self', 'csrf_token' => $token],
        ["X-CSRF-Token: {$token}"]
    );
    $t->resetSession();
    $createdMaster = $t->ensureMaster($masterName, $masterId, $password) || $createdMaster;
    if ($createdMaster) {
        $t->deleteSelf($masterName, $masterId, $password);
    }
});

// 5. 本番ガード検証（APP_ENV=production 時の挙動）
$runner->run('APP_ENV=production 時は delete_self で databaseDropped が false になる', function (ApiTestRunner $t) {
    $suffix = substr((string) microtime(true), -6) . '_' . random_int(100, 999);
    $masterName = "APIマスター_{$suffix}";
    $masterId = "api_master_{$suffix}";
    $password = 'Str0ng!Pass#2026';
    $createdMaster = $t->ensureMaster($masterName, $masterId, $password);

    $userName = "本番ガード_{$suffix}";
    $userId = "prod_guard_{$suffix}";

    $t->registerGeneral($userName, $userId, $password);
    $sessionToken = $t->login($userName, $userId, $password);

    $delRes = $t->post(
        ['action' => 'delete_self', 'csrf_token' => $sessionToken],
        ["X-CSRF-Token: {$sessionToken}"]
    );
    $t->assertEquals(200, $delRes['status'], 'delete_self should return 200');

    $appEnv = $delRes['body']['appEnv'] ?? getenv('APP_ENV');
    if ($appEnv === 'production') {
        $t->assertEquals(false, $delRes['body']['databaseDropped'] ?? null, 'databaseDropped should be false in production');
    } else {
        echo "  (note: current environment is not production; skipping strict databaseDropped=false assertion)\n";
    }
    if ($createdMaster) {
        $t->deleteSelf($masterName, $masterId, $password);
    }
});

// 6. LoginDatabase.php CSRF & 認証/ロール検証
$runner->run('LoginDatabase.php は CSRF 不正で403、未認証で401、一般ユーザーで403を返す', function (ApiTestRunner $t) use ($dbApiUrl) {
    // CSRF 欠落・不正（reset_logs は CSRF 保護対象）
    $resNoToken = $t->post(['action' => 'reset_logs'], [], $dbApiUrl);
    $t->assertEquals(403, $resNoToken['status'], 'Missing CSRF token on reset_logs should return 403');

    $resInvalidToken = $t->post(
        ['action' => 'reset_logs', 'csrf_token' => 'invalid_token_value'],
        ['X-CSRF-Token: invalid_token_value'],
        $dbApiUrl
    );
    $t->assertEquals(403, $resInvalidToken['status'], 'Invalid CSRF token on reset_logs should return 403');

    // 未認証時は 401
    $unauthRes = $t->post(['action' => 'check_db'], [], $dbApiUrl);
    $t->assertEquals(401, $unauthRes['status'], 'Unauthenticated check_db should return 401');

    $suffix = substr((string) microtime(true), -6) . '_' . random_int(100, 999);
    $masterName = "APIマスター_{$suffix}";
    $masterId = "api_master_{$suffix}";
    $password = 'Str0ng!Pass#2026';
    $createdMaster = $t->ensureMaster($masterName, $masterId, $password);

    $userName = "一般DB権限_{$suffix}";
    $userId = "gen_db_{$suffix}";

    $t->registerGeneral($userName, $userId, $password);
    $sessionToken = $t->login($userName, $userId, $password);

    foreach (['connect_db', 'get_logs'] as $action) {
        $res = $t->post(
            ['action' => $action, 'csrf_token' => $sessionToken],
            ["X-CSRF-Token: {$sessionToken}"],
            $dbApiUrl
        );
        $t->assertEquals(403, $res['status'], "General user should get 403 on {$action}");
    }

    // 後始末
    $t->post(
        ['action' => 'delete_self', 'csrf_token' => $sessionToken],
        ["X-CSRF-Token: {$sessionToken}"]
    );
    if ($createdMaster) {
        $t->deleteSelf($masterName, $masterId, $password);
    }
});

exit($runner->summary());