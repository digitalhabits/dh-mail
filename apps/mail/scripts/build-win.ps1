# Build the standalone Mail app for Windows: an NSIS installer per architecture,
# signed when the credentials are there.
#
# This is the Windows half of build-standalone.sh, and it follows what Blocker
# does. Two builds by default - x64 and ARM64 - because one installer cannot
# serve both; pass -x64Only or -arm64Only for one of them, and -Unsigned to
# leave a test build unsigned even where the credentials exist.
#
#   pnpm --dir apps/mail app:build:win
#   pnpm --dir apps/mail app:build:win:unsigned
#
# The Azure credentials live in apps/mail/.env.local, which git ignores. See
# scripts/sign.ps1 for the names, and README.md for what to put in them.
#
# What comes out lands in apps/mail/for-distribution/.

param(
    [switch]$x64Only,
    [switch]$arm64Only,
    [switch]$Unsigned
)

$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path $PSScriptRoot -Parent
Push-Location $AppRoot

try {
    Write-Host '=== Digital Habits Mail - Windows build ===' -ForegroundColor Cyan
    Write-Host ''

    # Same file the signing script reads. Read here as well, so this script can
    # say up front whether the build will be signed.
    $envFile = Join-Path $AppRoot '.env.local'
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#')) {
                $parts = $line -split '=', 2
                if ($parts.Length -eq 2) {
                    $key = $parts[0].Trim()
                    $value = $parts[1].Trim().Trim('"').Trim("'")
                    [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
                }
            }
        }
    }

    if ($Unsigned) {
        $env:DH_MAIL_SKIP_CODE_SIGN = '1'
        Write-Host '  Signing: skipped (-Unsigned). The installer will be unsigned.' -ForegroundColor Yellow
    }
    elseif ($env:AZURE_CLIENT_ID -and $env:AZURE_TENANT_ID -and $env:AZURE_CLIENT_SECRET) {
        # Everything the signing script needs, checked here rather than there.
        # sign.ps1 runs once per file the bundler puts in the installer, which
        # is a long way into the build - so a name it cannot do without should
        # stop this before the compile, not after it.
        if (-not $env:AZURE_SIGNING_ACCOUNT -or -not $env:AZURE_SIGNING_PROFILE) {
            Write-Host ''
            Write-Host '  ERROR: this build means to sign, but does not say what with.' -ForegroundColor Red
            Write-Host '  Add to apps/mail/.env.local:' -ForegroundColor Yellow
            Write-Host '    AZURE_SIGNING_ACCOUNT=<the Trusted Signing account>' -ForegroundColor Yellow
            Write-Host '    AZURE_SIGNING_PROFILE=<the certificate profile in it>' -ForegroundColor Yellow
            Write-Host '  Both are in Blocker''s scripts/sign.ps1. Or run with -Unsigned.' -ForegroundColor Yellow
            Write-Host ''
            exit 1
        }
        $cli = Join-Path $env:USERPROFILE '.cargo\bin\trusted-signing-cli.exe'
        if (-not (Test-Path $cli) -and -not (Get-Command trusted-signing-cli.exe -ErrorAction SilentlyContinue)) {
            Write-Host ''
            Write-Host '  ERROR: the Azure names are set but trusted-signing-cli is not installed.' -ForegroundColor Red
            Write-Host '    cargo install trusted-signing-cli --locked' -ForegroundColor Yellow
            Write-Host '  Or run with -Unsigned.' -ForegroundColor Yellow
            Write-Host ''
            exit 1
        }
        Write-Host "  Signing: Azure Trusted Signing ($env:AZURE_SIGNING_ACCOUNT/$env:AZURE_SIGNING_PROFILE)." -ForegroundColor Green
    }
    else {
        Write-Host '  Signing: none. Windows will warn about an unknown publisher.' -ForegroundColor Yellow
        Write-Host '  Put AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET and the' -ForegroundColor Gray
        Write-Host '  AZURE_SIGNING_* names in apps/mail/.env.local to sign.' -ForegroundColor Gray
    }
    Write-Host ''

    # The bundler finds SignTool through the registry, which can read the wrong
    # bitness on an ARM64 machine. Naming it outright avoids that.
    if (-not $env:TAURI_WINDOWS_SIGNTOOL_PATH) {
        $signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($signtool) {
            $env:TAURI_WINDOWS_SIGNTOOL_PATH = $signtool.FullName
            Write-Host "  SignTool: $($signtool.FullName)" -ForegroundColor Gray
        }
    }

    # Nothing that goes out should disagree with itself about what it is. The
    # check is a shell script; on Windows it runs under the Git bash that comes
    # with git, and is skipped rather than failed if there is none.
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if ($bash) {
        & $bash.Source './scripts/check-version.sh'
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    else {
        Write-Host '  check-version.sh skipped: no bash on this machine.' -ForegroundColor Yellow
    }

    $targets = @()
    if (-not $arm64Only) { $targets += 'x86_64-pc-windows-msvc' }
    if (-not $x64Only) { $targets += 'aarch64-pc-windows-msvc' }

    # How the bundler is told to sign, if it is to sign at all.
    #
    # Two things about signCommand, both from Blocker's
    # scripts/write-signing-config.ps1:
    #
    #   - The path has to be absolute. A relative one is not resolved against
    #     this folder, and the bundler stops with `program not found`.
    #   - The path must not be quoted, even around spaces. Tauri's Windows
    #     runner fails on a quoted command with os error 123. So a checkout
    #     under a path with a space in it cannot be signed against at all,
    #     and this says so at the start rather than failing strangely later.
    #
    # And one thing about reading its failures: `failed to run X` is what the
    # bundler says when X ran and exited non-zero, not when X would not start.
    # Three builds were spent reading it the other way, and each answer to the
    # wrong question - an absolute path, then a .cmd for an .exe, then a full
    # path to powershell - moved the message without fixing anything. What was
    # actually wrong was a syntax error in sign.ps1, which exited 1 every time.
    #
    # Written here rather than kept in tauri.windows.conf.json, which could
    # only ever hold a relative path. A build that is not signing writes
    # nothing and passes nothing, which is what makes -Unsigned mean it: a
    # bundler with no signCommand does not go looking for a signer.
    $signingArgs = @()
    if (-not $Unsigned -and $env:AZURE_CLIENT_ID -and $env:AZURE_TENANT_ID -and $env:AZURE_CLIENT_SECRET) {
        $signScript = (Resolve-Path (Join-Path $AppRoot 'scripts\sign.ps1')).Path
        if ($signScript -match ' ') {
            Write-Host ''
            Write-Host '  ERROR: this checkout is under a path with a space in it:' -ForegroundColor Red
            Write-Host "    $signScript" -ForegroundColor Gray
            Write-Host '  Tauri cannot be given a quoted signing command, so such a path' -ForegroundColor Yellow
            Write-Host '  cannot be signed against. Move the checkout, or run -Unsigned.' -ForegroundColor Yellow
            Write-Host ''
            exit 1
        }
        # Absolute, and Windows PowerShell rather than pwsh: it lives under
        # System32, whose path has no space in it, and every Windows machine
        # has it. `powershell` on its own is not enough - the bundler does not
        # search PATH, which is the whole reason this has to be spelled out.
        $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
        if (-not $psExe) {
            $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        }
        if (-not (Test-Path $psExe) -or $psExe -match ' ') {
            Write-Host ''
            Write-Host "  ERROR: no PowerShell this can name without quoting: $psExe" -ForegroundColor Red
            Write-Host '  Run with -Unsigned, or sign afterwards by hand.' -ForegroundColor Yellow
            Write-Host ''
            exit 1
        }

        $generated = Join-Path $AppRoot 'src-tauri\tauri.signing.generated.conf.json'
        $command = "$psExe -NoProfile -ExecutionPolicy Bypass -File $signScript %1"
        @{ bundle = @{ windows = @{ signCommand = $command } } } |
            ConvertTo-Json -Depth 5 |
            Set-Content -Path $generated -Encoding utf8
        $signingArgs = @('--config', 'src-tauri/tauri.signing.generated.conf.json')
        Write-Host "  Sign command: $command" -ForegroundColor Gray
        Write-Host ''
    }

    pnpm ui:build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    foreach ($target in $targets) {
        Write-Host ''
        Write-Host "Building $target..." -ForegroundColor Yellow
        rustup target add $target | Out-Null
        pnpm tauri build --target $target @signingArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Host ''
            Write-Host "  Build failed for $target." -ForegroundColor Red
            $log = Join-Path $env:TEMP 'dh-mail-sign.txt'
            if (Test-Path $log) {
                Write-Host "  If it stopped while signing, the last words are in $log :" -ForegroundColor Yellow
                Get-Content $log | Select-Object -Last 12 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
            }
            exit $LASTEXITCODE
        }
    }

    # Out of target/, into one folder with names anyone can read. Tauri names
    # the installer after productName, which has spaces in it.
    $version = (Get-Content (Join-Path $AppRoot 'package.json') | ConvertFrom-Json).version
    $productName = (Get-Content (Join-Path $AppRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json).productName
    $distDir = Join-Path $AppRoot 'for-distribution'
    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

    Write-Host ''
    Write-Host '=== Built ===' -ForegroundColor Cyan
    foreach ($target in $targets) {
        $arch = if ($target -like 'aarch64*') { 'arm64' } else { 'x64' }
        $source = Join-Path $AppRoot "src-tauri\target\$target\release\bundle\nsis\${productName}_${version}_${arch}-setup.exe"
        if (Test-Path $source) {
            $out = Join-Path $distDir "Digital-Habits-Mail_${version}_${arch}-setup.exe"
            Copy-Item $source $out -Force
            # .NET rather than Get-FileHash. The cmdlet needs a module that
            # is not always loadable where this runs: on the GitHub runner
            # it was missing, and a build that had compiled and signed both
            # installers failed on its last line and kept nothing. This
            # needs no module and works on every PowerShell.
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try {
                $bytes = [System.IO.File]::ReadAllBytes($out)
                $digest = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
            }
            finally {
                $sha.Dispose()
            }
            "$digest  " + (Split-Path $out -Leaf) | Set-Content "$out.sha256"
            Write-Host "  $out" -ForegroundColor Gray
        }
        else {
            Write-Host "  MISSING: $source" -ForegroundColor Red
            exit 1
        }
    }
    Write-Host ''
}
finally {
    Pop-Location
}
