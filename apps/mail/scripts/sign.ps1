# Code-sign one Windows binary with Azure Trusted Signing.
#
# The Tauri bundler calls this once per file it puts in the installer, and once
# for the installer itself - through src-tauri\sign.cmd, which is what
# tauri.windows.conf.json names. It is also fine to run by hand on a file.
#
# This is Blocker's arrangement, with the app-specific names taken out of the
# source. The signing account is a publisher identity rather than an app, so
# the same one signs both; which one it is lives in .env.local, because this
# repository is published.
#
# Nothing here fails a build for want of credentials. Without them the file
# goes out unsigned, which is what a local test build wants; a release build
# has them, and `build-win.ps1` says which of the two happened.
#
# ASCII only, in this file and the other .ps1 here. Git stores them as UTF-8
# with no byte order mark, and Windows PowerShell 5.1 reads a file without one
# as Windows-1252: an em dash comes back as three characters, the last of
# which is a right double quotation mark, which PowerShell honours as a
# closing quote. One em dash inside one double-quoted string is enough to
# unbalance the file, and what it reports then is a parse error tens of lines
# further down, in a comment. Three Windows builds were spent on that.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BinaryPath
)

$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path $PSScriptRoot -Parent
$LogFile = Join-Path $env:TEMP 'dh-mail-sign.txt'

function Write-Log([string]$Line) {
    Add-Content -Path $LogFile -Value $Line
}

Set-Content -Path $LogFile -Value "=== Digital Habits Mail - signing ==="
Write-Log "FILE=$BinaryPath"

# The bundler's signing subprocess does not reliably inherit what the build
# script set, so the file is read again here.
$envFile = Join-Path $AppRoot '.env.local'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line -split '=', 2
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $value = $parts[1].Trim().Trim('"').Trim("'")
                Set-Item -Path "Env:$key" -Value $value
            }
        }
    }
    Write-Log "ENV=$envFile"
}

if ($env:DH_MAIL_SKIP_CODE_SIGN -eq '1') {
    Write-Log 'SKIP=DH_MAIL_SKIP_CODE_SIGN=1'
    exit 0
}

if (-not $env:AZURE_CLIENT_ID -or -not $env:AZURE_TENANT_ID -or -not $env:AZURE_CLIENT_SECRET) {
    Write-Log 'SKIP=no Azure credentials'
    exit 0
}

# Not $profile: PowerShell already owns that name.
$account = $env:AZURE_SIGNING_ACCOUNT
$certProfile = $env:AZURE_SIGNING_PROFILE
if (-not $account -or -not $certProfile) {
    Write-Error @"
AZURE_CLIENT_ID is set, so this build means to sign, but it does not say what
with. Add to apps/mail/.env.local:
  AZURE_SIGNING_ACCOUNT=<the Trusted Signing account>
  AZURE_SIGNING_PROFILE=<the certificate profile in it>
Or leave the AZURE_* names out to build unsigned.
"@
    exit 1
}
$endpoint = if ($env:AZURE_SIGNING_ENDPOINT) { $env:AZURE_SIGNING_ENDPOINT } else { 'https://neu.codesigning.azure.net' }

# The Azure signing library is x64. On an ARM64 machine it runs under emulation
# and needs to be told where the x64 .NET runtime is.
$dotnetX64 = 'C:\Program Files\dotnet\x64'
if ((Test-Path $dotnetX64) -and -not $env:DOTNET_ROOT) {
    $env:DOTNET_ROOT = $dotnetX64
}

$cli = Join-Path $env:USERPROFILE '.cargo\bin\trusted-signing-cli.exe'
if (-not (Test-Path $cli)) {
    $onPath = Get-Command trusted-signing-cli.exe -ErrorAction SilentlyContinue
    if ($onPath) { $cli = $onPath.Source }
}
if (-not $cli -or -not (Test-Path $cli)) {
    Write-Log 'ERROR=trusted-signing-cli not found'
    Write-Error @"
trusted-signing-cli is not installed. Install it with:
  cargo install trusted-signing-cli --locked
Or leave the AZURE_* names out of apps/mail/.env.local to build unsigned.
See $LogFile
"@
    exit 1
}

$output = & $cli -e $endpoint -a $account -c $certProfile -d 'Digital Habits Mail' $BinaryPath 2>&1 | Out-String
$output | Add-Content -Path $LogFile
if ($LASTEXITCODE -ne 0) {
    Write-Log "EXIT_CODE=$LASTEXITCODE"
    Write-Error "Azure signing failed (exit $LASTEXITCODE). See $LogFile"
    exit $LASTEXITCODE
}

Write-Log 'EXIT_CODE=0'
exit 0
