<#
.SYNOPSIS
    Static source-regression test for the ServiceInstall/util:ServiceConfig
    recovery-action configuration in Package.wxs.

.DESCRIPTION
    PR 7/7 physical acceptance testing on 2026-07-14 found that the Service
    Control Manager had no failure-recovery actions configured for
    NoraMediBridge (verified on real hardware: `sc.exe qfailure NoraMediBridge`
    showed RESET_PERIOD 0 and no restart action). That silently defeats
    PostUpdateHealthTracker's crash-loop rollback safety net (PR 7/7): it only
    triggers an automatic rollback after observing 3 boots of the same bad
    version within its stabilization window (MaxRestartsBeforeRollback=3), but
    a version that crashes immediately on launch never got a 2nd or 3rd boot
    to be observed, because nothing restarts the process after the SCM
    records the first crash - the service just stays Stopped forever. The
    fix adds a util:ServiceConfig element nested in ServiceInstall so the SCM
    itself restarts the process on the 1st and 2nd failures, giving the
    detector the repeated-boot signal it needs, while ThirdFailureActionType
    stays "none" so a persistently broken install doesn't restart forever.

    This is a static content check, not a functional install (requires
    elevation this test environment does not have). Exits 0 only if every
    case passes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$packageWxsPath = Join-Path $repoRoot 'windows-bridge\installer\NoraMedi.Bridge.Installer\Package.wxs'
if (-not (Test-Path $packageWxsPath)) {
    throw "Cannot find Package.wxs at '$packageWxsPath'."
}

[xml]$wxs = Get-Content -LiteralPath $packageWxsPath -Raw
$ns = New-Object System.Xml.XmlNamespaceManager($wxs.NameTable)
$ns.AddNamespace('w', 'http://wixtoolset.org/schemas/v4/wxs')
$ns.AddNamespace('util', 'http://wixtoolset.org/schemas/v4/wxs/util')

$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([PSCustomObject]@{ Name = $Name; Passed = $Passed; Detail = $Detail })
}

$serviceInstallNode = $wxs.SelectSingleNode("//w:ServiceInstall[@Name='NoraMediBridge']", $ns)
Add-Result 'ServiceInstall for NoraMediBridge exists' ($null -ne $serviceInstallNode) ''

$serviceConfigNode = $null
if ($serviceInstallNode) {
    $serviceConfigNode = $serviceInstallNode.SelectSingleNode('util:ServiceConfig', $ns)
}
Add-Result 'util:ServiceConfig is nested inside ServiceInstall' ($null -ne $serviceConfigNode) ''

if ($serviceConfigNode) {
    Add-Result 'FirstFailureActionType is restart' `
        ($serviceConfigNode.GetAttribute('FirstFailureActionType') -eq 'restart') `
        "was '$($serviceConfigNode.GetAttribute('FirstFailureActionType'))'"

    Add-Result 'SecondFailureActionType is restart' `
        ($serviceConfigNode.GetAttribute('SecondFailureActionType') -eq 'restart') `
        "was '$($serviceConfigNode.GetAttribute('SecondFailureActionType'))'"

    Add-Result 'ThirdFailureActionType is none (no infinite restart loop for a persistently broken install)' `
        ($serviceConfigNode.GetAttribute('ThirdFailureActionType') -eq 'none') `
        "was '$($serviceConfigNode.GetAttribute('ThirdFailureActionType'))'"

    $resetPeriod = 0
    $resetPeriodOk = [int]::TryParse($serviceConfigNode.GetAttribute('ResetPeriodInDays'), [ref]$resetPeriod)
    Add-Result 'ResetPeriodInDays is a positive integer' ($resetPeriodOk -and $resetPeriod -gt 0) `
        "was '$($serviceConfigNode.GetAttribute('ResetPeriodInDays'))'"

    $restartDelay = 0
    $restartDelayOk = [int]::TryParse($serviceConfigNode.GetAttribute('RestartServiceDelayInSeconds'), [ref]$restartDelay)
    Add-Result 'RestartServiceDelayInSeconds is a positive integer' ($restartDelayOk -and $restartDelay -gt 0) `
        "was '$($serviceConfigNode.GetAttribute('RestartServiceDelayInSeconds'))'"
}
else {
    Add-Result 'FirstFailureActionType is restart' $false 'util:ServiceConfig node not found'
    Add-Result 'SecondFailureActionType is restart' $false 'util:ServiceConfig node not found'
    Add-Result 'ThirdFailureActionType is none (no infinite restart loop for a persistently broken install)' $false 'util:ServiceConfig node not found'
    Add-Result 'ResetPeriodInDays is a positive integer' $false 'util:ServiceConfig node not found'
    Add-Result 'RestartServiceDelayInSeconds is a positive integer' $false 'util:ServiceConfig node not found'
}

$failed = @($results | Where-Object { -not $_.Passed })
foreach ($r in $results) {
    $status = if ($r.Passed) { 'PASS' } else { 'FAIL' }
    $detailSuffix = if ($r.Detail) { " ($($r.Detail))" } else { '' }
    Write-Host "[$status] $($r.Name)$detailSuffix"
}

if ($failed.Count -gt 0) {
    Write-Host "`n$($failed.Count) of $($results.Count) checks FAILED."
    exit 1
}

Write-Host "`nAll $($results.Count) checks passed."
exit 0
