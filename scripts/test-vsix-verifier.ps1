$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
$artifact = (Resolve-Path -LiteralPath (Join-Path $repositoryRoot "dist\$($manifest.name)-$($manifest.version)-win32-x64.vsix")).Path
$testRoot = Join-Path $repositoryRoot 'build\vsix-verifier-negative'
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-VerificationFails([string]$Candidate, [string]$Label) {
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify-vsix.ps1') -ArtifactPath $Candidate *> $null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference
    if ($exitCode -eq 0) {
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

$engine = Copy-Candidate 'wrong-node-engine.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($engine, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $manifestEntry = $archive.GetEntry('extension/package.json')
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try { $packagedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $manifestEntry.Delete()
    $packagedManifest.engines.node = '>=99'
    $replacement = $archive.CreateEntry('extension/package.json')
    $writer = [System.IO.StreamWriter]::new($replacement.Open())
    try { $writer.Write(($packagedManifest | ConvertTo-Json -Depth 100 -Compress)) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Assert-VerificationFails $engine 'wrong Node engine'

$missingReadme = Copy-Candidate 'missing-readme.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($missingReadme, [System.IO.Compression.ZipArchiveMode]::Update)
try { $archive.GetEntry('extension/readme.md').Delete() } finally { $archive.Dispose() }
Assert-VerificationFails $missingReadme 'missing Details README'

$staleReadme = Copy-Candidate 'stale-readme.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($staleReadme, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $archive.GetEntry('extension/readme.md').Delete()
    $entry = $archive.CreateEntry('extension/readme.md')
    $writer = [System.IO.StreamWriter]::new($entry.Open())
    try { $writer.Write('outdated description') } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Assert-VerificationFails $staleReadme 'stale Details README'

$wrongDetails = Copy-Candidate 'wrong-details-asset.vsix'
$archive = [System.IO.Compression.ZipFile]::Open($wrongDetails, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $archive.GetEntry('extension.vsixmanifest')
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    $asset = $xml.SelectSingleNode("//*[local-name()='Asset' and @Type='Microsoft.VisualStudio.Services.Content.Details']")
    if ($null -eq $asset) { throw 'Valid archive must contain a Details asset.' }
    $asset.SetAttribute('Path', 'extension/docs/release-notes.md')
    $entry.Delete()
    $replacement = $archive.CreateEntry('extension.vsixmanifest')
    $writer = [System.IO.StreamWriter]::new($replacement.Open())
    try { $writer.Write($xml.OuterXml) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Assert-VerificationFails $wrongDetails 'wrong Details asset path'
