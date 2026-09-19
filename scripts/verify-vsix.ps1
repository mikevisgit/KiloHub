$ErrorActionPreference = 'Stop'

$artifact = Join-Path $PSScriptRoot '..\dist\kilo-hub-0.1.0-win32-x64.vsix'
$artifact = (Resolve-Path -LiteralPath $artifact).Path

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($artifact)

try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })
    $required = @(
        '[Content_Types].xml',
        'extension.vsixmanifest',
        'extension/package.json',
        'extension/build/extension.js',
        'extension/resources/hub.svg'
    )

    foreach ($path in $required) {
        if ($entries -notcontains $path) {
            throw "В VSIX отсутствует обязательный файл: $path"
        }
    }

    $forbidden = @(
        '^extension/src/',
        '^extension/tests/',
        '^extension/node_modules/',
        '^extension/req/',
        '^extension/specs/',
        '^extension/reviews/',
        '\.ts$',
        '\.map$',
        '\.db$',
        '-wal$',
        '-shm$',
        '/\.env$'
    )

    foreach ($path in $entries) {
        foreach ($pattern in $forbidden) {
            if ($path -match $pattern) {
                throw "В VSIX найден запрещённый файл: $path"
            }
        }
    }

    $manifestEntry = $archive.GetEntry('extension/package.json')
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try {
        $manifest = $reader.ReadToEnd() | ConvertFrom-Json
    }
    finally {
        $reader.Dispose()
    }

    if ($manifest.main -ne './build/extension.js') {
        throw "Некорректная точка входа VSIX: $($manifest.main)"
    }

    if ($manifest.engines.vscode -ne '^1.105.1') {
        throw "Некорректный engines.vscode: $($manifest.engines.vscode)"
    }

    $entryList = $entries | Sort-Object
    $entryList | ForEach-Object { $_ }
}
finally {
    $archive.Dispose()
}

$hash = Get-FileHash -LiteralPath $artifact -Algorithm SHA256
$size = (Get-Item -LiteralPath $artifact).Length
"VSIX: $artifact"
"Размер: $size байт"
"SHA-256: $($hash.Hash)"
