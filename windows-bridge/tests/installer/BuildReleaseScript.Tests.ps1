<#
.SYNOPSIS
    Static source-regression tests for windows-bridge/release/Build-Release.ps1
    covering four defects a Copilot review of PR 7/7 found (fixed in the same
    commit these tests were added in):

      1. signtool sign with -CertThumbprint must pass /sm so it can find a
         certificate in the LocalMachine store (the expected shape for a
         service-account/HSM/cloud-KSP-provisioned production identity) -
         signtool's default is CurrentUser\My only.
      2. The final signature-verification loop must include the UpdateHelper
         executable, not just Service/Manager/MSI/Bundle - it is signed
         earlier in the pipeline and is part of the shipped install surface.
      3. The /layout container-integrity check must require the actual
         extracted MSI file to exist, not merely the layout directory
         (Burn can create the directory before/without a successful
         extraction, which made the previous check nearly meaningless).
      4. The script's own doc comment must not contain the
         "clearly-unlabelled-as-unsigned" wording defect.
      5. The Bundle container-integrity check must use `wix burn extract`
         and a byte-hash comparison against the pre-signing MSI, not the
         bundle's own runtime `/layout` action + a bare
         `NoraMediBridge.msi` filename Test-Path. Found during PR 7/7
         physical acceptance testing on 2026-07-14: the chained MsiPackage
         is attached (embedded) inside the bundle container, so Burn's own
         `/layout` action for an attached package only ever copies the
         bundle exe itself and never writes a standalone MSI file - the
         previous check therefore failed unconditionally on every signed
         build (verified reproducing identically on a freshly built,
         never-signed bundle, ruling out the detach/sign/reattach sequence
         itself as the cause). `wix burn extract` is the tool that actually
         unpacks a bundle's attached containers; comparing an extracted
         payload's SHA-256 against the pre-signing MSI hash is what proves
         the sign sequence didn't corrupt the container.

    These are static content checks, not functional builds (a real signed
    build requires elevation/a certificate this test environment does not
    have - see docs/update-runbook.md "Production certificate status" and
    the physical-acceptance section of the PR 7/7 report). Exits 0 only if
    every case passes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptPath = Join-Path $PSScriptRoot '..\..\release\Build-Release.ps1'
if (-not (Test-Path $scriptPath)) { throw "Build-Release.ps1 not found at '$scriptPath'." }
$content = Get-Content $scriptPath -Raw

$results = New-Object System.Collections.Generic.List[pscustomobject]
function Add-Result([string]$Name, [bool]$Passed, [string]$Detail = '') {
    $results.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail })
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host "[$mark] $Name $Detail"
}

# --- Case 1: /sm on the certificate-store signing path ---------------------
$certSignLine = ($content -split "`n") | Where-Object { $_ -match 'signtool\.exe sign .*\$CertThumbprint' }
Add-Result 'Case 1: certificate-store signing path uses /sm (LocalMachine store)' `
    ($certSignLine -match '/sm\b') "line=$certSignLine"

# --- Case 2: UpdateHelper included in the post-sign verification loop ------
$verifyLoopMatch = [regex]::Match($content, 'Verifying signatures[\s\S]*?foreach \(\$file in @\(([\s\S]*?)\)\)')
Add-Result 'Case 2: signtool verify loop includes NoraMedi.Bridge.UpdateHelper.exe' `
    ($verifyLoopMatch.Success -and $verifyLoopMatch.Groups[1].Value -match 'UpdateHelper\.exe') `
    "found=$($verifyLoopMatch.Groups[1].Value)"

# --- Case 3/5: Bundle container-integrity check uses wix burn extract + hash compare ---
Add-Result 'Case 3/5: container check no longer relies on bundle /layout + bare MSI filename' `
    ($content -notmatch '"/layout"[\s\S]{0,400}NoraMediBridge\.msi') ''
Add-Result 'Case 3/5: container check invokes wix burn extract' `
    ($content -match 'wix\.exe burn extract') ''
Add-Result 'Case 3/5: container check compares extracted payload hash against pre-signing MSI hash' `
    ($content -match '\$preSignMsiHash\s*=\s*\(Get-FileHash\s+\$msiPath') ''
Add-Result 'Case 3/5: container check does not fall back to bare directory existence' `
    ($content -notmatch '\$extractOk\s*=[\s\S]{0,120}-or\s*\(Test-Path\s+\$extractDir\)') ''

# --- Case 4: no leftover wording defect -------------------------------------
Add-Result 'Case 4: no "clearly-unlabelled-as-unsigned" wording defect remains' `
    ($content -notmatch 'clearly-unlabelled-as-unsigned') ''

# --- Summary -----------------------------------------------------------------
# @(...) forces an array even when Where-Object matches zero/one item - under
# Set-StrictMode a bare scalar result has no .Count property (see this repo's
# own InstallerTestHelpers.Tests.ps1 header comment for the same class of bug).
$failed = @($results | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
    Write-Host "`n$($failed.Count) of $($results.Count) case(s) FAILED." -ForegroundColor Red
    exit 1
}
Write-Host "`nAll $($results.Count) case(s) passed."
exit 0
