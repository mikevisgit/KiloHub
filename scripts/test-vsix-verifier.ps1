$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$artifact = (Resolve-Path -LiteralPath (Join-Path $repositoryRoot "dist\$($manifest.name)-$($manifest.version)-win32-x64.vsix")).Path
$testRoot = Join-Path $repositoryRoot 'build\vsix-verifier-negative'
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-VerificationFails([string]$Candidate, [string]$Label) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-vsix.ps1') -ArtifactPath $Candidate *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "VSIX verifier accepted invalid case: $Label"
    }
    "PASS rejected: $Label"
}

function Copy-Candidate([string]$Name) {
    $candidate = Join-Path $testRoot $Name
    Copy-Item -LiteralPath $artifact -Destination $candidate -Force
    return $candidate
}

$extra = Copy-Candidate 'extra-entry.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($extra, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $archive.CreateEntry('extension/unexpected.txt')
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write('unexpected') } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Assert-VerificationFails $extra 'extra entry'

$missing = Copy-Candidate 'missing-webview.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($missing, [System.IO.Compression.ZipArchiveMode]::Update)
try { $archive.GetEntry('extension/build/webview/webview.js').Delete() } finally { $archive.Dispose() }
Assert-VerificationFails $missing 'missing browser bundle'

$stale = Copy-Candidate 'stale-webview.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($stale, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $archive.GetEntry('extension/build/webview/webview.js').Delete()
    $entry = $archive.CreateEntry('extension/build/webview/webview.js')
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write('stale') } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Assert-VerificationFails $stale 'stale browser bundle'
