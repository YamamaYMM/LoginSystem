<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
if (file_exists(__DIR__ . '/src/DatabaseActions.php')) {
    require_once __DIR__ . '/src/DatabaseActions.php';
}
require_once __DIR__ . '/src/DatabaseHandler.php';

start_secure_session();
header('Content-Type: application/json; charset=utf-8');

$input = read_json_input();
$action = (string)($input['action'] ?? 'test');

$csrfRequiredActions = ['connect_db', 'create', 'create_table', 'save_login', 'reset_logs'];
if (in_array($action, $csrfRequiredActions, true)) {
    verify_csrf_token($input);
}

$isDisconnected = !empty($input['disconnected']);
$cfg = load_db_config();

guard_login_db_request($action, $isDisconnected, $cfg);
dispatch_login_db_request($action, $input, $cfg);