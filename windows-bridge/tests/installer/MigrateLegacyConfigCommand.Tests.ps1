<#
.SYNOPSIS
    Deterministic, non-destructive test of the exact MigrateLegacyConfig
    cmd.exe command authored in Package.wxs, run directly against temp
    directories - no msiexec, no service, no admin rights, safe to run on
    any developer machine (unlike Invoke-InstallerIntegrationTests.ps1).

.DESCRIPTION
    A focused review found that the first draft of MigrateLegacyConfig's
    command used %D%/%S% (immediate cmd.exe variable expansion) on a single
    compound `a&b&c` line. cmd.exe expands %VAR% for the *entire* line once,
    before any part of the line executes, so %D%/%S% could not reliably see
    the values just assigned earlier on the same line. The fix switches to
    `/V:ON` (delayed expansion) with `!D!`/`!S!`.

    This script extracts the *exact* authored SetProperty Value from
    Package.wxs (not a hand-copied approximation), substitutes fake
    [CommonAppDataFolder]/[SERVICEFOLDER] paths - one of which deliberately
    contains a space, the way a real "Program Files" path does - and runs it
    through a real cmd.exe against a disposable temp directory tree,
    asserting exit codes and file state for every case the redesign was
    required to handle:

      1. Source exists, destination absent  -> copies, exit 0.
      2. Source absent                       -> no-op, exit 0.
      3. Destination already exists           -> no-op, no clobber, exit 0.
      4. Destination directory cannot be created (path occupied by a file,
         the same technique Scenario D of the installer harness uses)
                                               -> exit 1 (used later by
                                                  Return="check" to fail and
                                                  roll back the MSI action).

    Exits 0 if every case passes, 1 otherwise. Intended to be run directly
    (`powershell -File MigrateLegacyConfigCommand.Tests.ps1`) as part of the
    normal test suite - it is NOT part of Invoke-InstallerIntegrationTests.ps1
    and never touches a real install, service, or the real ProgramData/
    Program Files trees.
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
$setPropertyNode = $wxs.SelectSingleNode("//w:SetProperty[@Id='MigrateLegacyConfig']", $ns)
if (-not $setPropertyNode) {
    throw 'Could not find <SetProperty Id="MigrateLegacyConfig"> in Package.wxs. Has it been renamed?'
}
$authoredCommand = $setPropertyNode.Value
if ([string]::IsNullOrWhiteSpace($authoredCommand)) {
    throw 'SetProperty Id="MigrateLegacyConfig" has an empty Value attribute.'
}
if ($authoredCommand.Length -gt 255) {
    throw "Authored command is $($authoredCommand.Length) characters, over Windows Installer's 255-character CustomAction.Target limit (this should have already been caught by WiX's ICE03 at build time)."
}
if ($authoredCommand -notmatch '^"cmd\.exe" ') {
    throw "Expected the authored command to start with `"cmd.exe`" - cannot safely re-run it as a test. Got: $authoredCommand"
}
$cmdArgsTemplate = $authoredCommand.Substring('"cmd.exe" '.Length)

$results = New-Object System.Collections.Generic.List[pscustomobject]
function Add-Result([string]$Name, [bool]$Passed, [string]$Detail) {
    $results.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail })
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host "[$mark] $Name $Detail"
}

function Invoke-MigrateLegacyConfigCommand {
    param(
        [Parameter(Mandatory)][string]$CommonAppDataFolder,
        [Parameter(Mandatory)][string]$ServiceFolder
    )
    # Mirrors how Windows Installer resolves [Property] tokens before
    # cmd.exe ever sees the string, and how CAQuietExec's CreateProcess call
    # passes "cmd.exe" as argv[0] with everything else as the raw argument
    # string - not a second layer of shell quoting.
    # Literal (non-regex) substitution: these are resolved directory paths,
    # not patterns, and must be inserted exactly as-is.
    $cmdArgs = $cmdArgsTemplate.Replace('[CommonAppDataFolder]', $CommonAppDataFolder).Replace('[SERVICEFOLDER]', $ServiceFolder)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = $cmdArgs
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    return $proc.ExitCode
}

# Deliberately includes a space ("Program Files Test") the way a real
# Program Files path does, to prove the delayed-expansion fix and the
# quoting around !S!/!D! both survive a space in the resolved path.
$testRoot = Join-Path $env:TEMP "NoraMedi Cmd Test $([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

try {
    # --- Case 1: source exists, destination absent -> copies, exit 0 ---
    $case1Root = Join-Path $testRoot 'case1'
    $serviceDir1 = Join-Path $case1Root 'Program Files Test\Service'
    $dataDir1 = Join-Path $case1Root 'ProgramData Test'
    New-Item -ItemType Directory -Path $serviceDir1 -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $serviceDir1 'appsettings.json') -Value '{"BridgeSelfService":{"Enabled":true}}' -Encoding utf8

    $exit1 = Invoke-MigrateLegacyConfigCommand -CommonAppDataFolder "$dataDir1\" -ServiceFolder "$serviceDir1\"
    $destFile1 = Join-Path $dataDir1 'NoraMediBridge\config\appsettings.json'
    Add-Result 'Case 1: exit code 0' ($exit1 -eq 0) "exit=$exit1"
    Add-Result 'Case 1: destination file created' (Test-Path $destFile1) $destFile1
    if (Test-Path $destFile1) {
        $copied = (Get-Content -LiteralPath $destFile1 -Raw).TrimEnd("`r", "`n")
        Add-Result 'Case 1: destination content matches source' ($copied -eq '{"BridgeSelfService":{"Enabled":true}}') "got=$copied"
    }

    # --- Case 2: source absent -> no-op, exit 0, nothing created ---
    $case2Root = Join-Path $testRoot 'case2'
    $serviceDir2 = Join-Path $case2Root 'Program Files Test\Service'
    $dataDir2 = Join-Path $case2Root 'ProgramData Test'
    New-Item -ItemType Directory -Path $serviceDir2 -Force | Out-Null
    # Deliberately no appsettings.json written under $serviceDir2.

    $exit2 = Invoke-MigrateLegacyConfigCommand -CommonAppDataFolder "$dataDir2\" -ServiceFolder "$serviceDir2\"
    $destFile2 = Join-Path $dataDir2 'NoraMediBridge\config\appsettings.json'
    Add-Result 'Case 2: exit code 0 (no legacy source)' ($exit2 -eq 0) "exit=$exit2"
    Add-Result 'Case 2: no destination file created' (-not (Test-Path $destFile2)) $destFile2

    # --- Case 3: destination already exists -> no-op, no clobber, exit 0 ---
    $case3Root = Join-Path $testRoot 'case3'
    $serviceDir3 = Join-Path $case3Root 'Program Files Test\Service'
    $dataDir3 = Join-Path $case3Root 'ProgramData Test'
    $destDir3 = Join-Path $dataDir3 'NoraMediBridge\config'
    New-Item -ItemType Directory -Path $serviceDir3 -Force | Out-Null
    New-Item -ItemType Directory -Path $destDir3 -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $serviceDir3 'appsettings.json') -Value '{"BridgeSelfService":{"Enabled":true,"ServerUrl":"http://legacy.invalid"}}' -Encoding utf8
    Set-Content -LiteralPath (Join-Path $destDir3 'appsettings.json') -Value '{"BridgeSelfService":{"Enabled":false,"ServerUrl":"https://existing-override.invalid"}}' -Encoding utf8

    $exit3 = Invoke-MigrateLegacyConfigCommand -CommonAppDataFolder "$dataDir3\" -ServiceFolder "$serviceDir3\"
    $destFile3 = Join-Path $destDir3 'appsettings.json'
    $destContent3 = (Get-Content -LiteralPath $destFile3 -Raw).TrimEnd("`r", "`n")
    Add-Result 'Case 3: exit code 0 (destination already exists)' ($exit3 -eq 0) "exit=$exit3"
    Add-Result 'Case 3: existing override was never overwritten' ($destContent3 -eq '{"BridgeSelfService":{"Enabled":false,"ServerUrl":"https://existing-override.invalid"}}') "got=$destContent3"

    # --- Case 4: destination directory cannot be created -> exit 1 ---
    $case4Root = Join-Path $testRoot 'case4'
    $serviceDir4 = Join-Path $case4Root 'Program Files Test\Service'
    $dataDir4 = Join-Path $case4Root 'ProgramData Test'
    $blockedConfigPath4 = Join-Path $dataDir4 'NoraMediBridge\config'
    New-Item -ItemType Directory -Path $serviceDir4 -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $dataDir4 'NoraMediBridge') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $serviceDir4 'appsettings.json') -Value '{"BridgeSelfService":{"Enabled":true}}' -Encoding utf8
    # Occupy the "config" path with a plain file, so `md` (and therefore the
    # subsequent `copy`) cannot succeed - the same deterministic, reversible
    # failure technique Scenario D of the installer harness uses.
    New-Item -ItemType File -Path $blockedConfigPath4 -Force | Out-Null

    $exit4 = Invoke-MigrateLegacyConfigCommand -CommonAppDataFolder "$dataDir4\" -ServiceFolder "$serviceDir4\"
    Add-Result 'Case 4: exit code 1 (destination directory blocked)' ($exit4 -eq 1) "exit=$exit4"
}
finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$failed = $results | Where-Object { -not $_.Passed }
if ($failed) {
    Write-Host ""
    Write-Host "$($failed.Count) of $($results.Count) case(s) FAILED." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "All $($results.Count) case(s) passed." -ForegroundColor Green
exit 0
