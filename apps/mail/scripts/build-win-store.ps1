# Build the standalone Mail app as an MSIX, for the Microsoft Store.
#
# The other Windows build (build-win.ps1) makes an installer you host yourself
# and sign yourself. This one makes a package you upload to Partner Center,
# which is a different thing in three ways:
#
#   - Nothing is signed here. Microsoft re-signs the MSIX on ingest, which is
#     why the compile skips the bundler entirely (`--no-bundle`) and never
#     reaches sign.cmd.
#   - There is no WebView2 bootstrapper. The Store handles the dependency.
#   - The package carries an identity issued by Partner Center, which has to
#     match the reserved product exactly or the upload is refused.
#
# The reserved identity is written into this script - see below for why - so
# there is nothing to configure:
#
#   pnpm --dir apps/mail app:build:win-store
#
# What comes out: apps/mail/for-distribution/*.msix - upload it by hand under
# Packages. This script never submits anything.

param(
    [switch]$x64Only,
    [switch]$arm64Only,
    # Package what is already compiled. Useful when only the manifest changed.
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path $PSScriptRoot -Parent
Push-Location $AppRoot

try {
    Write-Host '=== Digital Habits Mail - Microsoft Store package ===' -ForegroundColor Cyan
    Write-Host ''

    $envFile = Join-Path $AppRoot '.env.local'
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#')) {
                $parts = $line -split '=', 2
                if ($parts.Length -eq 2) {
                    [System.Environment]::SetEnvironmentVariable(
                        $parts[0].Trim(), $parts[1].Trim().Trim('"').Trim("'"), 'Process')
                }
            }
        }
    }

    # Mail's reserved identity, from Partner Center -> Digital Habits: Mail ->
    # Product identity. Written here rather than kept in .env.local because
    # none of it is a secret: every one of these three appears in the manifest
    # of every package that ships, and the Store page quotes them back. Holding
    # them out of the repository would only mean a build that cannot run
    # without a file nobody has.
    #
    # The publisher GUID is the seller account, so it is the same as Blocker's.
    # The identity name is this product's alone.
    $identityName = if ($env:WINDOWS_IDENTITY_NAME) { $env:WINDOWS_IDENTITY_NAME }
                    else { 'ReduceDigitalDistraction.DigitalHabitsMail' }
    $publisher = if ($env:WINDOWS_PUBLISHER) { $env:WINDOWS_PUBLISHER }
                 else { 'CN=EC16037E-D0B5-446F-9912-F41B3DCCBFB3' }
    $publisherDisplayName = if ($env:WINDOWS_PUBLISHER_DISPLAY_NAME) { $env:WINDOWS_PUBLISHER_DISPLAY_NAME }
                            else { 'Centre for Digital Habits' }

    $version = (Get-Content (Join-Path $AppRoot 'package.json') | ConvertFrom-Json).version
    # The Store wants four parts, and reserves the last for itself.
    $msixVersion = "$version.0"
    Write-Host "  Digital Habits: Mail $msixVersion" -ForegroundColor White
    Write-Host "  Identity  $identityName" -ForegroundColor Gray
    Write-Host "  Publisher $publisher" -ForegroundColor Gray
    Write-Host '  Signing   none - Partner Center re-signs on upload.' -ForegroundColor Gray
    Write-Host ''

    $makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $makeappx) {
        Write-Host '  ERROR: makeappx.exe not found. Install the Windows SDK.' -ForegroundColor Red
        exit 1
    }

    $targets = @()
    if (-not $arm64Only) { $targets += 'x86_64-pc-windows-msvc' }
    if (-not $x64Only) { $targets += 'aarch64-pc-windows-msvc' }

    if (-not $SkipBuild) {
        pnpm ui:build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    $distDir = Join-Path $AppRoot 'for-distribution'
    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

    foreach ($target in $targets) {
        $arch = if ($target -like 'aarch64*') { 'arm64' } else { 'x64' }
        Write-Host ''
        Write-Host "Packaging $arch..." -ForegroundColor Yellow

        if (-not $SkipBuild) {
            rustup target add $target | Out-Null
            # --no-bundle: the compiled exe is all this needs. It also means the
            # bundler never runs, so nothing here is signed.
            pnpm tauri build --target $target --no-bundle
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }

        $exe = Join-Path $AppRoot "src-tauri\target\$target\release\digital-habits-mail.exe"
        if (-not (Test-Path $exe)) {
            Write-Host "  ERROR: nothing compiled at $exe" -ForegroundColor Red
            Write-Host '  Run without -SkipBuild.' -ForegroundColor Yellow
            exit 1
        }

        $staging = Join-Path $AppRoot "msix-build\$arch"
        if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        $assets = Join-Path $staging 'Assets'
        New-Item -ItemType Directory -Path $assets | Out-Null

        # Every logo the manifest names already exists at exactly the right
        # size: `tauri icon` generated the Square*Logo set for Windows when it
        # made the .icns and the .ico. So this renames rather than resizes, and
        # needs no image library.
        #
        # Only scale-100 assets, so Windows scales the tile itself on a
        # high-DPI display. Adding scale-200 and scale-400 means generating
        # 300px and 600px versions from a source bigger than the 512px icon.png
        # - worth doing if the tile ever looks soft, not worth it before then.
        Write-Host '  [1/4] Icon assets...' -ForegroundColor Gray
        $iconDir = Join-Path $AppRoot 'src-tauri\icons-standalone'
        $logos = @{
            'StoreLogo.png'          = 'StoreLogo.scale-100.png'
            'Square44x44Logo.png'    = 'Square44x44Logo.scale-100.png'
            'Square150x150Logo.png'  = 'Square150x150Logo.scale-100.png'
            'Square71x71Logo.png'    = 'SmallTile.scale-100.png'
            'Square310x310Logo.png'  = 'LargeTile.scale-100.png'
        }
        foreach ($from in $logos.Keys) {
            $source = Join-Path $iconDir $from
            if (-not (Test-Path $source)) {
                Write-Host "  ERROR: missing icon $source" -ForegroundColor Red
                Write-Host '  Regenerate with: pnpm tauri icon' -ForegroundColor Yellow
                exit 1
            }
            Copy-Item $source (Join-Path $assets $logos[$from])
        }

        Write-Host '  [2/4] AppxManifest.xml...' -ForegroundColor Gray
        $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="$identityName"
    Publisher="$publisher"
    Version="$msixVersion"
    ProcessorArchitecture="$arch" />

  <Properties>
    <DisplayName>Digital Habits: Mail</DisplayName>
    <PublisherDisplayName>$publisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.scale-100.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Applications>
    <Application Id="App" Executable="digital-habits-mail.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Digital Habits: Mail"
        Description="Mail that reads like a chat."
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.scale-100.png"
        Square44x44Logo="Assets\Square44x44Logo.scale-100.png">
        <uap:DefaultTile Square71x71Logo="Assets\SmallTile.scale-100.png" Square310x310Logo="Assets\LargeTile.scale-100.png" />
        <uap:SplashScreen Image="Assets\Square150x150Logo.scale-100.png" />
      </uap:VisualElements>
    </Application>
  </Applications>

  <!-- runFullTrust and nothing else. Mail keeps its store and its tokens to
       itself, so it needs no exemption from MSIX's virtual file system or
       registry - which is what Blocker needs, and what makes its manifest
       longer than this one. -->
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
        # No BOM: makeappx rejects one.
        [System.IO.File]::WriteAllText(
            (Join-Path $staging 'AppxManifest.xml'),
            $manifest,
            (New-Object System.Text.UTF8Encoding $false))

        Write-Host '  [3/4] Staging...' -ForegroundColor Gray
        Copy-Item $exe $staging
        # Present only when WebView2 is linked dynamically. Harmless either way.
        $loader = Join-Path $AppRoot "src-tauri\target\$target\release\WebView2Loader.dll"
        if (Test-Path $loader) { Copy-Item $loader $staging }

        Write-Host '  [4/4] makeappx...' -ForegroundColor Gray
        $msix = Join-Path $distDir "Digital-Habits-Mail_${msixVersion}_${arch}.msix"
        & $makeappx.FullName pack /d $staging /p $msix /o
        if ($LASTEXITCODE -ne 0) {
            Write-Host '  ERROR: makeappx failed.' -ForegroundColor Red
            exit $LASTEXITCODE
        }
        Write-Host "  $msix" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Upload these under Packages in Partner Center. Microsoft signs them there.' -ForegroundColor Yellow
    Write-Host 'The identity in .env.local must match Product identity exactly, or the' -ForegroundColor Yellow
    Write-Host 'upload is refused.' -ForegroundColor Yellow
    Write-Host ''
}
finally {
    Pop-Location
}
