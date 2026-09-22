param(
    [string]$ArtifactPath
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceManifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
if ($sourceManifest.version -ne '0.3.0') {
    throw "Step 3 release requires package version 0.3.0, found $($sourceManifest.version)."
}
$artifactName = "$($sourceManifest.name)-$($sourceManifest.version)-win32-x64.vsix"
$artifactCandidate = if ([string]::IsNullOrWhiteSpace($ArtifactPath)) {
    Join-Path $repositoryRoot "dist\$artifactName"
} else {
    $ArtifactPath
}
$artifact = (Resolve-Path -LiteralPath $artifactCandidate).Path

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($artifact)

try {
    $expectedEntries = @(
        '[Content_Types].xml',
        'extension.vsixmanifest',
        'extension/LICENSE.txt',
        'extension/build/extension.js',
        'extension/build/kiloDataWorker.js',
        'extension/build/hubIndexWorker.js',
        'extension/build/webview/webview.css',
        'extension/build/webview/webview.js',
        'extension/docs/release-notes.md',
        'extension/package.json',
        'extension/readme.md',
        'extension/resources/hub.svg',
        'extension/resources/kilo-hub.png'
    ) | Sort-Object
    $entries = @($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
    $difference = @(Compare-Object -ReferenceObject $expectedEntries -DifferenceObject $entries)
    if ($difference.Count -ne 0) {
        throw "VSIX entries do not match the exact allow-list: $($difference | Out-String)"
    }

    $manifestEntry = $archive.GetEntry('extension/package.json')
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try {
        $manifest = $reader.ReadToEnd() | ConvertFrom-Json
    }
    finally {
        $reader.Dispose()
    }

    if ($manifest.name -ne $sourceManifest.name -or
        $manifest.publisher -ne $sourceManifest.publisher -or
        $manifest.version -ne $sourceManifest.version) {
        throw 'Packaged extension identity does not match package.json.'
    }
    if ($manifest.main -ne './build/extension.js') {
        throw "Unexpected VSIX entry point: $($manifest.main)"
    }
    if ($manifest.icon -ne 'resources/kilo-hub.png') {
        throw 'Unexpected extension page icon.'
    }
    foreach ($iconName in @('kilo-hub.png', 'hub.svg')) {
    $iconStream = $archive.GetEntry("extension/resources/$iconName").Open()
    $iconHasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $iconHash = ([BitConverter]::ToString($iconHasher.ComputeHash($iconStream))).Replace('-', '')
    } finally {
        $iconStream.Dispose()
        $iconHasher.Dispose()
    }
    if ($iconHash -ne (Get-FileHash -LiteralPath (Join-Path $repositoryRoot "resources/$iconName") -Algorithm SHA256).Hash) {
        throw 'Packaged icon does not match source icon.'
    }
    }
    if ($manifest.engines.vscode -ne '^1.105.1') {
        throw "Unexpected engines.vscode: $($manifest.engines.vscode)"
    }
    if ($manifest.engines.node -ne '>=22.19.0 <25') {
        throw "Unexpected engines.node: $($manifest.engines.node)"
    }
    $extensionKinds = @($manifest.extensionKind)
    if ($extensionKinds.Count -ne 1 -or $extensionKinds[0] -ne 'ui') {
        throw 'Unexpected extensionKind.'
    }

    $expectedActivation = @('onStartupFinished', 'onCommand:kiloHub.refresh', 'onView:kiloHub.folders') | Sort-Object
    if (@(Compare-Object $expectedActivation @($manifest.activationEvents | Sort-Object)).Count -ne 0) {
        throw 'Unexpected activation events.'
    }
    $expectedCommands = @(
        'kiloHub.openHere',
        'kiloHub.openInFileExplorer',
        'kiloHub.openNewWindow',
        'kiloHub.refresh'
    ) | Sort-Object
    $actualCommands = @($manifest.contributes.commands | ForEach-Object { $_.command } | Sort-Object)
    if (@(Compare-Object $expectedCommands $actualCommands).Count -ne 0) {
        throw 'Unexpected command contributions.'
    }
    $activityContainers = @($manifest.contributes.viewsContainers.activitybar)
    $folderViews = @($manifest.contributes.views.kiloHub)
    if ($activityContainers.Count -ne 1 -or
        $activityContainers[0].id -ne 'kiloHub' -or
        $folderViews.Count -ne 1 -or
        $folderViews[0].id -ne 'kiloHub.folders' -or
        $folderViews[0].name -ne 'Kilo Hub' -or
        $folderViews[0].type -ne 'webview') {
        throw 'Unexpected view contributions.'
    }
    if ($null -ne $manifest.contributes.menus.'view/title') {
        throw 'Native view/title menu must not be packaged for Step 2.'
    }

    $deploymentEntry = $archive.GetEntry('extension.vsixmanifest')
    $reader = [System.IO.StreamReader]::new($deploymentEntry.Open())
    try {
        $deploymentManifest = $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }
    if ($deploymentManifest -notmatch 'TargetPlatform="win32-x64"') {
        throw 'VSIX target platform is not win32-x64.'
    }
    [xml]$deploymentXml = $deploymentManifest
    $details = @($deploymentXml.SelectNodes("//*[local-name()='Asset' and @Type='Microsoft.VisualStudio.Services.Content.Details']"))
    if ($details.Count -ne 1 -or $details[0].GetAttribute('Path') -ne 'extension/readme.md') {
        throw 'VSIX does not map Details to the packaged README.'
    }
    $readmeStream = $archive.GetEntry('extension/readme.md').Open()
    $readmeHasher = [System.Security.Cryptography.SHA256]::Create()
    try {
        $readmeHash = ([BitConverter]::ToString($readmeHasher.ComputeHash($readmeStream))).Replace('-', '')
    } finally {
        $readmeStream.Dispose()
        $readmeHasher.Dispose()
    }
    if ($readmeHash -ne (Get-FileHash -LiteralPath (Join-Path $repositoryRoot 'docs/extension-description.md') -Algorithm SHA256).Hash) {
        throw 'Packaged Details README does not match the canonical description.'
    }

    foreach ($bundleName in @('extension.js', 'kiloDataWorker.js', 'hubIndexWorker.js', 'webview/webview.js', 'webview/webview.css')) {
        $bundleEntry = $archive.GetEntry("extension/build/$bundleName")
        $bundleStream = $bundleEntry.Open()
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $packagedBundleHash = ([BitConverter]::ToString($sha256.ComputeHash($bundleStream))).Replace('-', '')
        }
        finally {
            $sha256.Dispose()
            $bundleStream.Dispose()
        }
        $sourceBundleHash = (Get-FileHash -LiteralPath (Join-Path $repositoryRoot "build\$bundleName") -Algorithm SHA256).Hash
        if ($packagedBundleHash -ne $sourceBundleHash) {
            throw "Packaged bundle does not match the fresh build output: $bundleName"
        }
    }

    $entries | ForEach-Object { $_ }
}
finally {
    $archive.Dispose()
}

$hash = Get-FileHash -LiteralPath $artifact -Algorithm SHA256
$size = (Get-Item -LiteralPath $artifact).Length
"VSIX: $artifact"
"Size: $size bytes"
"SHA-256: $($hash.Hash)"
