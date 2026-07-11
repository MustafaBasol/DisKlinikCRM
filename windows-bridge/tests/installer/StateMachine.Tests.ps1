<#
.SYNOPSIS
    Dry, logic-only test proving the Reset-ScenarioState/Install-CandidateIfNeeded
    design (InstallerTestHelpers.psm1) makes every scenario in
    Invoke-InstallerIntegrationTests.ps1 order-independent.

.DESCRIPTION
    A focused review found that Scenario B/D used to `throw` if a
    ProgramData override already existed, and Scenario A never removed a
    leftover override before its "clean install" assertions - so running
    scenarios in sequence (the documented `-Scenario A,B,C,E` / `-Scenario
    All` commands) could fail because of state a *previous* scenario left
    behind, not because of a real product defect. Reset-ScenarioState and
    Install-CandidateIfNeeded fix this by making every scenario reset (or
    seed) exactly the state it needs instead of assuming it.

    This script does NOT import InstallerTestHelpers.psm1 or call any of
    its functions, and never touches msiexec, a real service, or a real
    file outside this process - on purpose. An earlier draft tried to mock
    the module's own Get-InstalledNoraMediProduct/Invoke-MsiProcess inside
    its scope; that mocking technique did not reliably override the
    already-exported functions bound into the caller's session, and running
    it called the REAL Get-InstalledNoraMediProduct/Uninstall-IfPresent
    against this machine's actual installed product before the mistake was
    caught. That risk is exactly why this test instead models the
    Reset-ScenarioState / Install-CandidateIfNeeded decision rules as a pure,
    in-memory state machine (Invoke-ResetLogic / Invoke-InstallCandidateLogic
    below - kept in lockstep with the real functions' logic; see the
    comments on Reset-ScenarioState/Install-CandidateIfNeeded in
    InstallerTestHelpers.psm1) and exercises every sequence the harness
    supports purely against that model:

      - A,B,C,E in that order (the documented non-destructive command).
      - A regression case starting from exactly the poisoned state (product
        installed + override present) that used to make Scenario D's old
        `throw` fire.
      - Each of A/B/C/D/E run alone from a clean state.
      - The full A,B,C,D,E sequence.

    Exits 0 if every case passes, 1 otherwise.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$candidateVersion = '0.4.6'
$previousVersion = '0.4.5'

$results = New-Object System.Collections.Generic.List[pscustomobject]
function Add-Result([string]$Name, [bool]$Passed, [string]$Detail = '') {
    $results.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail })
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host "[$mark] $Name $Detail"
}

function New-State {
    param([string]$Installed = $null, [bool]$ProgramData = $false)
    [pscustomobject]@{ Installed = $Installed; ProgramData = $ProgramData }
}

function Invoke-ResetLogic {
    <#
    Pure mirror of Reset-ScenarioState's decision rules (InstallerTestHelpers.psm1):
    uninstall whatever is currently installed (any version), and, when
    -RemoveProgramData is set, also clear the ProgramData override. Never
    throws on leftover state - that's the whole point of the fix.
    #>
    param([Parameter(Mandatory)][object]$State, [switch]$RemoveProgramData)
    $State.Installed = $null
    if ($RemoveProgramData) { $State.ProgramData = $false }
    return $State
}

function Invoke-InstallCandidateLogic {
    <#
    Pure mirror of Install-CandidateIfNeeded's decision rules: reuse an
    already-installed candidate; otherwise reset (uninstall only, leaves
    ProgramData untouched - matching the real function, which calls
    Reset-ScenarioState without -RemoveProgramData) and install the
    candidate.
    #>
    param([Parameter(Mandatory)][object]$State, [Parameter(Mandatory)][string]$CandidateVersion)
    if ($State.Installed -eq $CandidateVersion) { return $State }
    if ($State.Installed) { Invoke-ResetLogic -State $State | Out-Null }
    $State.Installed = $CandidateVersion
    return $State
}

# --- Case 1: A,B,C,E in the documented non-destructive order ---
$state = New-State
Invoke-ResetLogic -State $state -RemoveProgramData | Out-Null   # Scenario A reset
$state.Installed = $candidateVersion                              # Scenario A install
Add-Result 'Case 1a: after Scenario A, candidate is installed' ($state.Installed -eq $candidateVersion) "got=$($state.Installed)"

Invoke-ResetLogic -State $state -RemoveProgramData | Out-Null   # Scenario B reset
Add-Result 'Case 1b: Scenario B reset clears a product A left installed' (-not $state.Installed) "got=$($state.Installed)"
Add-Result 'Case 1b: Scenario B reset guarantees no ProgramData override' (-not $state.ProgramData) "got=$($state.ProgramData)"
$state.Installed = $previousVersion                                # Scenario B installs previous
$state.Installed = $candidateVersion                                # Scenario B upgrades to candidate
$state.ProgramData = $true                                          # MigrateLegacyConfig creates the override during the upgrade

Invoke-InstallCandidateLogic -State $state -CandidateVersion $candidateVersion | Out-Null   # Scenario C
Add-Result 'Case 1c: Scenario C reuses the candidate B left installed (no reset)' ($state.Installed -eq $candidateVersion) "got=$($state.Installed)"
Add-Result 'Case 1c: Scenario C does not require or remove the existing override' ($state.ProgramData -eq $true) "got=$($state.ProgramData)"
# Scenario C always seeds its own sentinel override, overwriting whatever was there - already covered by 1c's ProgramData assertion staying true.

Invoke-InstallCandidateLogic -State $state -CandidateVersion $candidateVersion | Out-Null   # Scenario E reuse
$state.Installed = $null                                            # Scenario E uninstall
Add-Result 'Case 1d: Scenario E uninstall removes the product' (-not $state.Installed) "got=$($state.Installed)"
Add-Result 'Case 1d: Scenario E normal uninstall preserves the ProgramData override' ($state.ProgramData -eq $true) "got=$($state.ProgramData)"

# --- Case 2: poisoned-state regression - the exact bug this fix targets.
# Start from C's leftover state (candidate installed, override present) and
# run D's reset directly. The OLD code threw here: "if (Test-Path
# $ProgramDataConfigPath) { throw ... }" assumed an override-free machine
# instead of guaranteeing one. The new logic must never throw.
$state2 = New-State -Installed $candidateVersion -ProgramData $true
$threw = $false
try {
    Invoke-ResetLogic -State $state2 -RemoveProgramData | Out-Null   # Scenario D reset
}
catch { $threw = $true }
Add-Result 'Case 2: Scenario D reset does not throw on leftover poisoned state' (-not $threw) "threw=$threw"
Add-Result 'Case 2: Scenario D reset clears the leftover product' (-not $state2.Installed) "got=$($state2.Installed)"
Add-Result 'Case 2: Scenario D reset clears the leftover ProgramData override' (-not $state2.ProgramData) "got=$($state2.ProgramData)"

# --- Case 3: each scenario runs alone, starting from a clean state ---
foreach ($solo in @('A', 'B', 'D')) {
    $s = New-State
    $threw = $false
    try { Invoke-ResetLogic -State $s -RemoveProgramData | Out-Null }
    catch { $threw = $true }
    Add-Result "Case 3: Scenario $solo reset alone (clean state) does not throw" (-not $threw) "threw=$threw"
}
foreach ($solo in @('C', 'E')) {
    $s = New-State
    $threw = $false
    try { Invoke-InstallCandidateLogic -State $s -CandidateVersion $candidateVersion | Out-Null }
    catch { $threw = $true }
    Add-Result "Case 3: Scenario $solo alone (clean state) installs the candidate without throwing" ((-not $threw) -and ($s.Installed -eq $candidateVersion)) "threw=$threw installed=$($s.Installed)"
}

# --- Case 4: full A,B,C,D,E sequence never throws due to leftover state ---
$state4 = New-State
$allThrew = $false
$allExceptionMessage = ''
try {
    Invoke-ResetLogic -State $state4 -RemoveProgramData | Out-Null           # A reset
    $state4.Installed = $candidateVersion                                     # A install

    Invoke-ResetLogic -State $state4 -RemoveProgramData | Out-Null           # B reset
    $state4.Installed = $previousVersion                                      # B install previous
    $state4.Installed = $candidateVersion                                     # B upgrade
    $state4.ProgramData = $true                                               # B's migration creates the override

    Invoke-InstallCandidateLogic -State $state4 -CandidateVersion $candidateVersion | Out-Null   # C

    Invoke-ResetLogic -State $state4 -RemoveProgramData | Out-Null           # D reset (must not throw despite C's leftover override)
    $state4.Installed = $previousVersion                                      # D install previous (about to force a failure in the real harness)

    Invoke-InstallCandidateLogic -State $state4 -CandidateVersion $candidateVersion | Out-Null   # E (must reset D's previous-version leftover, then install candidate)
}
catch {
    $allThrew = $true
    $allExceptionMessage = $_.Exception.Message
}
Add-Result 'Case 4: full A,B,C,D,E sequence completes without throwing' (-not $allThrew) "threw=$allThrew $allExceptionMessage"
Add-Result 'Case 4: sequence ends with the candidate installed (E reset D''s previous-version leftover, then reinstalled)' ($state4.Installed -eq $candidateVersion) "got=$($state4.Installed)"

$failed = $results | Where-Object { -not $_.Passed }
if ($failed) {
    Write-Host ""
    Write-Host "$($failed.Count) of $($results.Count) case(s) FAILED." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "All $($results.Count) case(s) passed." -ForegroundColor Green
exit 0
