<?php
// db_config.php
declare(strict_types=1);

$env = static function (string $key, string $default): string {
    $val = getenv($key);
    if ($val !== false && $val !== '') {
        return $val;
    }
    if (isset($_ENV[$key]) && $_ENV[$key] !== '') {
        return (string) $_ENV[$key];
    }
    return $default;
};

return [
    'host' => $env('DB_HOST', 'localhost'),
    'dbname' => $env('DB_NAME', 'logindatabase'),
    'user' => $env('DB_USER', 'root'),
    'pass' => $env('DB_PASS', ''),
];