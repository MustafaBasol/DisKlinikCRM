<#
.SYNOPSIS
    Canonical, deterministic, fail-closed release build for the NoraMedi
    Windows Bridge (PR 7/7). Produces self-contained Service/Manager/
    UpdateHelper publishes, the MSI, the Burn Setup EXE, and a
    machine-readable release manifest with final SHA-256 hashes computed
    only after all signing is complete.

.DESCRIPTION
    Two modes:

      Unsigned (default) - for CI PR validation and local iteration. Produces
      an MSI/Bundle clearly labelled as unsigned. Never claims to be a
      production release.

      Signed (-Release) - requires an explicit signing identity
      (-CertThumbprint, resolved from a Windows certificate store - the
      production-safe path a hardware/HSM/cloud-backed cert also uses; OR
      -PfxPath+-PfxPasswordEnvVar for an ephemeral local test certificate,
      physical-acceptance-testing only, never accepted when -ProductionRelease
      is also set). Runs WiX Burn's documented detach -> sign engine ->
      reattach -> sign bundle sequence (see docs/update-runbook.md - signing
      the assembled bundle directly produces a file that *reports* as validly
      signed but is not actually installable). Verifies every signature
      after signing and extracts the final bundle via `/layout` (Burn's own
      no-install self-extraction check) to prove the attached containers are
      not corrupted before any hash is computed.

.PARAMETER Version
    Required. Three-field MSI ProductVersion (Major.Minor.Build, each
    0-255). Applied identically to the MSI, Bundle, Service, Manager, and
    UpdateHelper FileVersion so every artifact traces to one release.

.PARAMETER Release
    Switch. Enables signing. Requires a signing identity (-CertThumbprint or
    -PfxPath). Without this switch the script always produces an unsigned,
    clearly-labelled release-candidate build and never touches a certificate.

.PARAMETER ProductionRelease
    Switch. Additionally forbids the ephemeral -PfxPath test-signing path -
    only a certificate-store identity (-CertThumbprint) is accepted. Use this
    from the protected CI release workflow; never set it for a physical-test
    build.

.PARAMETER CertThumbprint
    SHA-1 thumbprint of a code-signing certificate already present in a
    Windows certificate store (local machine or user store, or a
    store-backed HSM/cloud-signing provider that exposes itself as a normal
    certificate + private key through CNG/KSP). This is the production-safe
    path - no exportable private key material ever needs to touch the
    filesystem or this script's argument list beyond the thumbprint itself.

.PARAMETER PfxPath
    Path to an ephemeral local test .pfx (physical-acceptance testing only).
    Rejected outright when -ProductionRelease is set. The password is read
    from an environment variable (-PfxPasswordEnvVar), never a script
    parameter, so it can never appear in process listings or shell history.

.PARAMETER PfxPasswordEnvVar
    Name (not value) of an environment variable holding the PFX password.
    Defaults to NORAMEDI_TEST_PFX_PASSWORD.

.PARAMETER TimestampUrl
    RFC 3161 timestamp authority URL. Required whenever -Release is set -
    an unsigned-for-timestamp build is refused because a certificate-only
    signature stops verifying the moment the certificate itself expires.

.PARAMETER OutputDirectory
    Where the final MSI/Bundle/manifest are copied. Defaults to
    C:\artifacts\<Version> for a -Release build, or
    C:\artifacts\<Version>-unsigned for an unsigned build, unless overridden.

.PARAMETER BuildCommit
    Git commit SHA this release traces to. Auto-detected via `git rev-parse
    HEAD` in the repo root if not supplied.

.EXAMPLE
    # CI PR validation - unsigned structural build, no certificate touched.
    .\Build-Release.ps1 -Version 0.4.8

.EXAMPLE
    # Physical-acceptance test build with an ephemeral local certificate.
    $env:NORAMEDI_TEST_PFX_PASSWORD = '...'
    .\Build-Release.ps1 -Version 0.4.8 -Release -PfxPath C:\temp\test.pfx -TimestampUrl http://timestamp.digicert.com

.EXAMPLE
    # Protected production release workflow - certificate-store identity only.
    .\Build-Release.ps1 -Version 0.4.8 -Release -ProductionRelease `
        -CertThumbprint $env:NORAMEDI_SIGNING_THUMBPRINT -TimestampUrl http://timestamp.digicert.com
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$Release,

    [switch]$ProductionRelease,

    [string]$CertThumbprint,

    [string]$PfxPath,

    [string]$PfxPasswordEnvVar = 'NORAMEDI_TEST_PFX_PASSWORD',

    [string]$TimestampUrl,

    [string]$OutputDirectory,

    [string]$BuildCommit,

    [switch]$AllowDirtyTree
)

$ErrorActionPreference = 'Stop'
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:BridgeRoot = Join-Path $RepoRoot 'windows-bridge'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

# -- 1. Validate version -----------------------------------------------------
if ($Version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}$') {
    Fail "Invalid -Version '$Version' - must be Major.Minor.Build, each 0-255 (MSI ProductVersion constraint)."
}
foreach ($part in $Version.Split('.')) {
    if ([int]$part -gt 255) { Fail "Invalid -Version '$Version' - each field must be <= 255." }
}

# -- 2. Resolve signing identity requirements (fail closed) -----------------
if ($Release) {
    if (-not $CertThumbprint -and -not $PfxPath) {
        Fail "-Release requires a signing identity: pass -CertThumbprint (certificate-store / HSM / cloud-signing identity, production-safe) or -PfxPath (ephemeral local test cert, physical-test only)."
    }
    if ($CertThumbprint -and $PfxPath) {
        Fail "Pass only one of -CertThumbprint or -PfxPath, not both."
    }
    if ($ProductionRelease -and $PfxPath) {
        Fail "-ProductionRelease forbids -PfxPath (ephemeral test certificates are never a production release input). Use -CertThumbprint with a real certificate-store/HSM/cloud-signing identity."
    }
    if (-not $TimestampUrl) {
        Fail "-Release requires -TimestampUrl - an untimestamped signature stops verifying the moment the certificate expires."
    }
    if ($PfxPath -and -not (Test-Path $PfxPath)) {
        Fail "-PfxPath '$PfxPath' does not exist."
    }
    if ($PfxPath -and -not (Get-Item "env:$PfxPasswordEnvVar" -ErrorAction SilentlyContinue)) {
        Fail "Environment variable '$PfxPasswordEnvVar' (PFX password) is not set. The password is never accepted as a script parameter."
    }
}
else {
    if ($CertThumbprint -or $PfxPath) {
        Fail "A signing identity was supplied but -Release was not - pass -Release explicitly to sign, or omit the signing parameters for an unsigned build. This script never signs implicitly."
    }
}

# -- 3. Clean repository state (unless explicitly overridden for local iteration) --
Write-Step "Checking repository state"
Push-Location $RepoRoot
try {
    $status = git status --porcelain 2>$null
    if ($Release -and $status -and -not $AllowDirtyTree) {
        Fail "Repository has uncommitted changes - refusing to build a signed release from a dirty tree. Commit/stash first, or pass -AllowDirtyTree for local iteration only (never for a real release)."
    }
    if (-not $BuildCommit) {
        $BuildCommit = (git rev-parse HEAD 2>$null)
        if (-not $BuildCommit) { $BuildCommit = 'unknown' }
    }
}
finally {
    Pop-Location
}
Write-Host "Build commit: $BuildCommit"

# -- 4. Clean publish/build directories --------------------------------------
Write-Step "Cleaning publish/build directories"
$publishRoot = Join-Path $BridgeRoot 'publish'
$installerBin = Join-Path $BridgeRoot 'installer\NoraMedi.Bridge.Installer\bin'
$bundleBin = Join-Path $BridgeRoot 'installer\NoraMedi.Bridge.Bundle\bin'
foreach ($dir in @($publishRoot, $installerBin, $bundleBin)) {
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
}

if (-not $OutputDirectory) {
    $suffix = if ($Release) { '' } else { '-unsigned' }
    $OutputDirectory = "C:\artifacts\$Version$suffix"
}
if (Test-Path $OutputDirectory) { Remove-Item $OutputDirectory -Recurse -Force }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null

# -- 5. Publish Service / Manager / UpdateHelper -----------------------------
Write-Step "Publishing Service (self-contained win-x64)"
dotnet publish "$BridgeRoot\src\NoraMedi.Bridge.Service\NoraMedi.Bridge.Service.csproj" -c Release -r win-x64 `
    --self-contained true -p:PublishSingleFile=false -p:Version=$Version -p:FileVersion=$Version.0 `
    -o "$publishRoot\Service"
if ($LASTEXITCODE -ne 0) { Fail "Service publish failed." }

Write-Step "Publishing Manager (self-contained win-x64)"
dotnet publish "$BridgeRoot\src\NoraMedi.Bridge.Manager\NoraMedi.Bridge.Manager.csproj" -c Release -r win-x64 `
    --self-contained true -p:PublishSingleFile=false -p:Version=$Version -p:FileVersion=$Version.0 `
    -o "$publishRoot\Manager"
if ($LASTEXITCODE -ne 0) { Fail "Manager publish failed." }

Write-Step "Publishing UpdateHelper (self-contained win-x64)"
dotnet publish "$BridgeRoot\src\NoraMedi.Bridge.UpdateHelper\NoraMedi.Bridge.UpdateHelper.csproj" -c Release -r win-x64 `
    --self-contained true -p:PublishSingleFile=false -p:Version=$Version -p:FileVersion=$Version.0 `
    -o "$publishRoot\Service\UpdateHelper"
if ($LASTEXITCODE -ne 0) { Fail "UpdateHelper publish failed." }

# -- 6. Sign the individual PE files BEFORE the MSI harvests them -----------
function Invoke-SignTool([string[]]$Files) {
    foreach ($file in $Files) {
        if ($CertThumbprint) {
            # /sm searches the LocalMachine stores, not just CurrentUser\My (signtool's
            # default) - required for a service-account/HSM/cloud-KSP-provisioned
            # certificate, which is the expected production identity shape.
            & signtool.exe sign /sm /sha1 $CertThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $file
        }
        else {
            $pwd = (Get-Item "env:$PfxPasswordEnvVar").Value
            & signtool.exe sign /f $PfxPath /p $pwd /fd SHA256 /tr $TimestampUrl /td SHA256 $file
        }
        if ($LASTEXITCODE -ne 0) { Fail "signtool sign failed for '$file'." }
    }
}

if ($Release) {
    Write-Step "Signing Service/Manager/UpdateHelper executables (before MSI harvest)"
    $peFiles = @(
        "$publishRoot\Service\NoraMediBridge.Service.exe",
        "$publishRoot\Manager\NoraMediBridge.Manager.exe",
        "$publishRoot\Service\UpdateHelper\NoraMedi.Bridge.UpdateHelper.exe"
    )
    Invoke-SignTool -Files $peFiles
}

# -- 7. Build the MSI --------------------------------------------------------
Write-Step "Building MSI"
dotnet build "$BridgeRoot\installer\NoraMedi.Bridge.Installer" -c Release `
    -p:PublishServiceDir="$publishRoot\Service" `
    -p:PublishManagerDir="$publishRoot\Manager" `
    -p:ProductVersion=$Version
if ($LASTEXITCODE -ne 0) { Fail "MSI build failed." }
$msiPath = "$BridgeRoot\installer\NoraMedi.Bridge.Installer\bin\x64\Release\NoraMediBridge.msi"
if (-not (Test-Path $msiPath)) { Fail "Expected MSI not found at '$msiPath'." }

if ($Release) {
    Write-Step "Signing MSI"
    Invoke-SignTool -Files @($msiPath)
}

# -- 8. Build the Bundle (unsigned first - Burn needs the raw engine to detach) --
Write-Step "Building Bundle"
dotnet build "$BridgeRoot\installer\NoraMedi.Bridge.Bundle" -c Release `
    -p:MsiSourceFile=$msiPath `
    -p:ProductVersion=$Version
if ($LASTEXITCODE -ne 0) { Fail "Bundle build failed." }
$bundlePath = "$BridgeRoot\installer\NoraMedi.Bridge.Bundle\bin\x64\Release\NoraMediBridgeSetup.exe"
if (-not (Test-Path $bundlePath)) { Fail "Expected Bundle not found at '$bundlePath'." }

# -- 9. Burn detach -> sign engine -> reattach -> sign bundle (documented sequence) --
if ($Release) {
    Write-Step "Signing Bundle (Burn detach/sign-engine/reattach/sign-bundle sequence)"
    $engineTemp = Join-Path $env:TEMP "nmb-engine-$([Guid]::NewGuid().ToString('N')).exe"
    try {
        & wix.exe burn detach $bundlePath -engine $engineTemp
        if ($LASTEXITCODE -ne 0) { Fail "wix burn detach failed." }

        Invoke-SignTool -Files @($engineTemp)

        & wix.exe burn reattach $bundlePath -engine $engineTemp -out $bundlePath
        if ($LASTEXITCODE -ne 0) { Fail "wix burn reattach failed." }

        # Step 5 of the documented sequence: the reattach output itself is NOT
        # yet validly signed (docs/update-runbook.md) - this second signature
        # on the final reattached file is what WinVerifyTrust/AuthenticodeVerifier
        # actually check.
        Invoke-SignTool -Files @($bundlePath)
    }
    finally {
        if (Test-Path $engineTemp) { Remove-Item $engineTemp -Force }
    }

    # -- 10. Verify signatures after signing ---------------------------------
    Write-Step "Verifying signatures"
    foreach ($file in @($msiPath, $bundlePath, "$publishRoot\Service\NoraMediBridge.Service.exe", "$publishRoot\Manager\NoraMediBridge.Manager.exe", "$publishRoot\Service\UpdateHelper\NoraMedi.Bridge.UpdateHelper.exe")) {
        & signtool.exe verify /pa /v $file
        if ($LASTEXITCODE -ne 0) { Fail "signtool verify failed for '$file' - refusing to publish a release whose own signature doesn't verify." }
    }

    # -- 11. Verify the Bundle's attached container isn't corrupted -------------
    # The chained MsiPackage is attached (embedded) inside the bundle exe's own
    # container, not staged as an external payload. The bundle's own runtime
    # `/layout` action therefore only ever copies the bundle exe itself for an
    # attached package - it does not write out a separate MSI file - so a
    # Test-Path for a standalone MSI after `/layout` always fails regardless of
    # whether detach/sign/reattach corrupted anything. The tool that actually
    # unpacks attached containers is `wix burn extract` (docs/update-runbook.md);
    # its output is verified byte-for-byte against the pre-signing MSI hash,
    # which is what actually proves the detach/reattach sequence didn't corrupt
    # the container (both Get-AuthenticodeSignature and signtool verify can
    # report a corrupted bundle as validly signed; only unpacking it reveals
    # the defect).
    Write-Step "Verifying Bundle container integrity via 'wix burn extract'"
    $preSignMsiHash = (Get-FileHash $msiPath -Algorithm SHA256).Hash
    $extractDir = Join-Path $env:TEMP "nmb-extract-$([Guid]::NewGuid().ToString('N'))"
    & wix.exe burn extract $bundlePath -o $extractDir
    $extractExit = $LASTEXITCODE
    $extractOk = $false
    if ($extractExit -eq 0 -and (Test-Path $extractDir)) {
        $extractOk = @(Get-ChildItem $extractDir -File -Recurse | Where-Object {
            (Get-FileHash $_.FullName -Algorithm SHA256).Hash -eq $preSignMsiHash
        }).Count -gt 0
    }
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    if ($extractExit -ne 0 -or -not $extractOk) {
        Fail "Bundle container extraction failed or its attached MSI payload does not hash-match the pre-signing MSI (wix burn extract exit $extractExit) - the container is likely corrupted by the sign sequence. Never publish this artifact."
    }
}
else {
    Write-Host "Unsigned build - skipping signature verification and /layout container check (nothing signed to verify)." -ForegroundColor Yellow
}

# -- 12. Copy final artifacts and compute hashes ONLY from the final signed bytes --
Write-Step "Copying artifacts and computing final hashes"
Copy-Item $msiPath (Join-Path $OutputDirectory 'NoraMediBridge.msi') -Force
Copy-Item $bundlePath (Join-Path $OutputDirectory 'NoraMediBridgeSetup.exe') -Force

$finalMsi = Join-Path $OutputDirectory 'NoraMediBridge.msi'
$finalBundle = Join-Path $OutputDirectory 'NoraMediBridgeSetup.exe'
$msiHash = (Get-FileHash $finalMsi -Algorithm SHA256).Hash.ToLower()
$bundleHash = (Get-FileHash $finalBundle -Algorithm SHA256).Hash.ToLower()
$msiSize = (Get-Item $finalMsi).Length
$bundleSize = (Get-Item $finalBundle).Length

$signerIdentity = if ($Release) { if ($CertThumbprint) { $CertThumbprint } else { '(ephemeral local test certificate - not a production identity)' } } else { $null }

# -- 13. Best-effort SBOM (package inventory per project) -------------------
Write-Step "Generating best-effort SBOM"
$sbom = @{ generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); projects = @() }
foreach ($proj in @('NoraMedi.Bridge.Core', 'NoraMedi.Bridge.Service', 'NoraMedi.Bridge.Manager', 'NoraMedi.Bridge.UpdateHelper')) {
    $csproj = Get-ChildItem -Path "$BridgeRoot\src\$proj" -Filter '*.csproj' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $csproj) { continue }
    $listOutput = & dotnet list $csproj.FullName package --include-transitive --format json 2>$null
    $packages = $null
    try { $packages = ($listOutput | ConvertFrom-Json) } catch { $packages = $null }
    $sbom.projects += @{ name = $proj; packages = $packages }
}
$sbomPath = Join-Path $OutputDirectory 'sbom.json'
$sbom | ConvertTo-Json -Depth 10 | Out-File -FilePath $sbomPath -Encoding utf8

# -- 14. Release metadata descriptor (from FINAL signed bytes only) ---------
$manifest = [ordered]@{
    version           = $Version
    buildCommit       = $BuildCommit
    builtAtUtc        = (Get-Date).ToUniversalTime().ToString('o')
    signed            = [bool]$Release
    productionRelease = [bool]$ProductionRelease
    signerIdentity    = $signerIdentity
    timestampAuthority = $(if ($Release) { $TimestampUrl } else { $null })
    artifacts         = @(
        [ordered]@{ name = 'NoraMediBridge.msi'; sha256 = $msiHash; sizeBytes = $msiSize },
        [ordered]@{ name = 'NoraMediBridgeSetup.exe'; sha256 = $bundleHash; sizeBytes = $bundleSize }
    )
    sbom              = 'sbom.json'
}
$manifestPath = Join-Path $OutputDirectory 'release-metadata.json'
$manifest | ConvertTo-Json -Depth 10 | Out-File -FilePath $manifestPath -Encoding utf8

if (-not $Release) {
    "UNSIGNED RELEASE-CANDIDATE BUILD - NOT PRODUCTION-RELEASABLE`nVersion: $Version`nBuildCommit: $BuildCommit`nBuiltAtUtc: $($manifest.builtAtUtc)`nThis artifact carries no Authenticode signature and must never be offered as a production update." |
        Out-File -FilePath (Join-Path $OutputDirectory 'UNSIGNED-NOT-FOR-PRODUCTION.txt') -Encoding utf8
}
elseif (-not $ProductionRelease) {
    "EPHEMERAL TEST-SIGNED BUILD - NOT PRODUCTION-RELEASABLE`nVersion: $Version`nBuildCommit: $BuildCommit`nBuiltAtUtc: $($manifest.builtAtUtc)`nSigned with a local ephemeral test certificate for physical-acceptance testing only." |
        Out-File -FilePath (Join-Path $OutputDirectory 'TEST-SIGNED-NOT-FOR-PRODUCTION.txt') -Encoding utf8
}

Write-Step "Release build complete"
Write-Host "Output directory: $OutputDirectory"
Write-Host "  NoraMediBridge.msi        sha256=$msiHash size=$msiSize"
Write-Host "  NoraMediBridgeSetup.exe   sha256=$bundleHash size=$bundleSize"
if (-not $Release) {
    Write-Host "`nUNSIGNED build - not a production release. Do not publish these artifacts as a production update." -ForegroundColor Yellow
}
elseif (-not $ProductionRelease) {
    Write-Host "`nSigned with an ephemeral/test identity - not a production release." -ForegroundColor Yellow
}
