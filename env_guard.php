<?php
// env_guard.php
declare(strict_types=1);

function get_app_env(): string
{
    $val = getenv('APP_ENV');
    if ($val !== false && trim((string) $val) !== '') {
        return strtolower(trim((string) $val));
    }
    if (isset($_ENV['APP_ENV']) && trim((string) $_ENV['APP_ENV']) !== '') {
        return strtolower(trim((string) $_ENV['APP_ENV']));
    }
    // 未設定時は安全のため本番扱い
    return 'production';
}

function app_env_name(): string
{
    return get_app_env();
}

function is_production(): bool
{
    return get_app_env() === 'production';
}

function is_production_env(): bool
{
    return is_production();
}

function is_debug_env(): bool
{
    return in_array(get_app_env(), ['local', 'test', 'development'], true);
}

/**
 * 本番環境では画面へのエラー表示を隠し、ログファイルへ記録する
 */
function configure_error_handling(?string $logFilePath = null): void
{
    if (is_production()) {
        ini_set('display_errors', '0');
        ini_set('display_startup_errors', '0');
        error_reporting(E_ALL);
        ini_set('log_errors', '1');
        if ($logFilePath !== null && $logFilePath !== '') {
            ini_set('error_log', $logFilePath);
        }
    } else {
        ini_set('display_errors', '1');
        ini_set('display_startup_errors', '1');
        error_reporting(E_ALL);
    }
}

/**
 * テスト専用処理やシード/リセットAPIを本番で遮断する
 */
function block_in_production(string $message = 'Forbidden in production'): void
{
    if (is_production()) {
        http_response_code(403);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode([
            'status' => 'error',
            'message' => $message,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/**
 * 本番では何も出力しないデバッグ用ヘルパー
 */
function debug_log_safe(mixed $data, string $label = 'DEBUG'): void
{
    if (is_production()) {
        return;
    }
    error_log('[' . $label . '] ' . print_r($data, true));
}