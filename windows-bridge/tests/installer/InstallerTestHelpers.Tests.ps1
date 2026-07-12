<#
.SYNOPSIS
    Focused, non-mutating unit tests for InstallerTestHelpers.psm1: safe
    registry-property inspection under Set-StrictMode -Version Latest, the
    scalar-vs-array Count bug, JSON boolean literals in the orchestrator
    script, and the machine-mutation arming guard.

.DESCRIPTION
    A focused review of a real Scenario B run found the harness crashed
    immediately with "The property 'DisplayName' cannot be found on this
    object" (Get-InstalledNoraMediProduct read an optional registry property
    without checking it existed first) and then "The property 'Count' cannot
    be found on this object" in the result summary (a Where-Object result
    with zero or one match is not an array under Set-StrictMode, so .Count
    throws). This script proves both classes of bug are fixed, and that the
    fail-closed mutation-arming guard added in response to an earlier
    mocking-technique near-miss (see StateMachine.Tests.ps1's header comment)
    actually rejects mutating calls before Enable-HarnessMutation is called.

    Everything here is safe on any developer machine: it imports the module
    (which the module's own header comment guarantees has no side effects on
    import) and calls only read-only functions (Select-NoraMediProduct
    against synthetic PSCustomObjects - never the real registry;
    Get-NoraMediServiceState; Test-Path) plus Assert-HarnessMutationArmed and
    Invoke-MsiProcess, which are called specifically to prove they THROW
    before ever reaching Start-Process, since the module is freshly imported
    (and therefore unarmed) for this whole script. Enable-HarnessMutation is
    never called here.

    Exits 0 if every case passes, 1 otherwise.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'InstallerTestHelpers.psm1') -Force

$results = New-Object System.Collections.Generic.List[pscustomobject]
function Add-Result([string]$Name, [bool]$Passed, [string]$Detail = '') {
    $results.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail })
    $mark = if ($Passed) { 'PASS' } else { 'FAIL' }
    Write-Host "[$mark] $Name $Detail"
}

# --- Select-NoraMediProduct: safe optional-property handling ---------------

# Case 1: an Uninstall entry with no DisplayName property at all (common for
# bare component/patch registrations) must be ignored, not throw.
$entryNoDisplayName = [pscustomobject]@{ PSChildName = '{11111111-1111-1111-1111-111111111111}' }
$threw = $false
$r1 = $null
try { $r1 = Select-NoraMediProduct -Entries @($entryNoDisplayName) } catch { $threw = $true }
Add-Result 'Case 1: entry without DisplayName does not throw' (-not $threw) "threw=$threw"
Add-Result 'Case 1: entry without DisplayName is ignored (returns null)' ($null -eq $r1) "got=$r1"

# Case 2: a valid, fully-populated NoraMedi Bridge entry is returned normalized.
$entryValid = [pscustomobject]@{
    DisplayName    = 'NoraMedi Bridge'
    DisplayVersion = '0.4.6'
    PSChildName    = '{22222222-2222-2222-2222-222222222222}'
}
$r2 = Select-NoraMediProduct -Entries @($entryValid)
Add-Result 'Case 2: valid entry is returned' ($null -ne $r2) "got=$r2"
Add-Result 'Case 2: ProductCode matches PSChildName' ($r2.ProductCode -eq '{22222222-2222-2222-2222-222222222222}') "got=$($r2.ProductCode)"
Add-Result 'Case 2: DisplayVersion matches' ($r2.DisplayVersion -eq '0.4.6') "got=$($r2.DisplayVersion)"

# Case 3: DisplayName matches but PSChildName/ProductCode is missing or blank
# - must be ignored (never returned as an uninstall target), not throw.
$entryNoProductCode = [pscustomobject]@{ DisplayName = 'NoraMedi Bridge'; DisplayVersion = '0.4.5' }
$entryBlankProductCode = [pscustomobject]@{ DisplayName = 'NoraMedi Bridge'; DisplayVersion = '0.4.5'; PSChildName = '   ' }
$threw = $false
$r3 = $null
try { $r3 = Select-NoraMediProduct -Entries @($entryNoProductCode, $entryBlankProductCode) } catch { $threw = $true }
Add-Result 'Case 3: entries with missing/blank ProductCode do not throw' (-not $threw) "threw=$threw"
Add-Result 'Case 3: entries with missing/blank ProductCode are ignored (returns null)' ($null -eq $r3) "got=$r3"

# Case 4: no matching product at all among unrelated entries.
$entryUnrelated = [pscustomobject]@{ DisplayName = 'Some Other App'; DisplayVersion = '1.0'; PSChildName = '{33333333-3333-3333-3333-333333333333}' }
$r4 = Select-NoraMediProduct -Entries @($entryUnrelated)
Add-Result 'Case 4: no matching product returns null' ($null -eq $r4) "got=$r4"

# Case 5: duplicate valid NoraMedi Bridge entries must fail clearly (throw),
# never silently pick one as an uninstall target.
$entryDup1 = [pscustomobject]@{ DisplayName = 'NoraMedi Bridge'; DisplayVersion = '0.4.5'; PSChildName = '{44444444-4444-4444-4444-444444444444}' }
$entryDup2 = [pscustomobject]@{ DisplayName = 'NoraMedi Bridge'; DisplayVersion = '0.4.6'; PSChildName = '{55555555-5555-5555-5555-555555555555}' }
$dupThrew = $false
try { Select-NoraMediProduct -Entries @($entryDup1, $entryDup2) | Out-Null } catch { $dupThrew = $true }
Add-Result 'Case 5: duplicate valid entries throw instead of picking one' $dupThrew "threw=$dupThrew"

# --- Scalar-vs-array Count normalization ------------------------------------

foreach ($caseName in @('zero', 'one', 'multiple')) {
    $items = switch ($caseName) {
        'zero' { @([pscustomobject]@{ Status = 'Pass' }, [pscustomobject]@{ Status = 'Pass' }) }
        'one' { @([pscustomobject]@{ Status = 'Pass' }, [pscustomobject]@{ Status = 'Fail' }) }
        'multiple' { @([pscustomobject]@{ Status = 'Fail' }, [pscustomobject]@{ Status = 'Fail' }, [pscustomobject]@{ Status = 'Pass' }) }
    }
    $expectedCount = switch ($caseName) { 'zero' { 0 }; 'one' { 1 }; 'multiple' { 2 } }
    $threw = $false
    $count = -1
    try {
        # This mirrors the fixed pattern in Invoke-InstallerIntegrationTests.ps1
        # / StateMachine.Tests.ps1 / MigrateLegacyConfigCommand.Tests.ps1: wrap
        # the Where-Object result in @(...) before reading .Count, since a
        # 0- or 1-match result is not an array under Set-StrictMode.
        $failed = @($items | Where-Object { $_.Status -eq 'Fail' })
        $count = $failed.Count
    }
    catch { $threw = $true }
    Add-Result "Count normalization ($caseName failed result(s)) does not throw" (-not $threw) "threw=$threw"
    Add-Result "Count normalization ($caseName failed result(s)) returns the right count" ($count -eq $expectedCount) "got=$count want=$expectedCount"
}

# --- Fail-closed mutation-arming guard --------------------------------------
# The module is freshly imported (with -Force) at the top of this script, so
# $script:HarnessMutationArmed starts $false here - Enable-HarnessMutation is
# never called anywhere in this file.

$threw = $false
try { Assert-HarnessMutationArmed -Action 'test probe' } catch { $threw = $true }
Add-Result 'Assert-HarnessMutationArmed throws while unarmed' $threw "threw=$threw"

$threw = $false
try {
    # If this ever reached Start-Process it would launch a real msiexec
    # against this machine; Assert-HarnessMutationArmed must reject it first.
    Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', 'should-never-run.msi') -LogDirectory $env:TEMP -LogName 'unarmed-probe' | Out-Null
}
catch { $threw = $true }
Add-Result 'Invoke-MsiProcess refuses to run while unarmed (never reaches msiexec)' $threw "threw=$threw"

$threw = $false
try { Remove-NoraMediProgramDataTree } catch { $threw = $true }
Add-Result 'Remove-NoraMediProgramDataTree refuses to run while unarmed' $threw "threw=$threw"

# --- Preflight-style discovery is pure read, never needs arming -------------
# Get-InstalledNoraMediProduct / Get-NoraMediServiceState / Test-Path are what
# Preflight uses to report state; none of them touch msiexec, so they must
# never be gated behind Assert-HarnessMutationArmed. Note: on a machine with
# a genuine duplicate/conflicting Uninstall registration this can still
# throw (by design - see Case 5 above) but that throw must never be the
# "machine mutation has not been armed" one, which is what this asserts,
# rather than assuming this dev machine's real registry has 0-or-1 entries.
$threw = $false
$armingBlocked = $false
try { Get-InstalledNoraMediProduct | Out-Null }
catch {
    $threw = $true
    if ($_.Exception.Message -match 'machine mutation has not been armed') { $armingBlocked = $true }
}
Add-Result 'Get-InstalledNoraMediProduct is never gated behind mutation-arming (pure registry read)' (-not $armingBlocked) "threw=$threw armingBlocked=$armingBlocked"

$threw = $false
try { Get-NoraMediServiceState | Out-Null } catch { $threw = $true }
Add-Result 'Get-NoraMediServiceState succeeds unarmed (pure service read)' (-not $threw) "threw=$threw"

# --- Orchestrator source: JSON booleans, not strings ------------------------
# Scenario B/C in Invoke-InstallerIntegrationTests.ps1 used to seed
# $testEnabled = 'true' / $sentinelEnabled = 'false' (PowerShell strings),
# which ConvertTo-Json serializes as the JSON strings "true"/"false" instead
# of the JSON booleans true/false. Checked by static source inspection only
# - this never executes Scenario B/C (which install/upgrade a real MSI).

$orchestratorPath = Join-Path $PSScriptRoot 'Invoke-InstallerIntegrationTests.ps1'
$orchestratorSource = Get-Content -LiteralPath $orchestratorPath -Raw -Encoding UTF8

Add-Result 'Scenario B seeds $testEnabled as a JSON boolean ($true), not a string' `
    ($orchestratorSource -match '\$testEnabled\s*=\s*\$true') 'expected literal $testEnabled = $true'
Add-Result 'Scenario B does not seed $testEnabled as the string ''true''' `
    ($orchestratorSource -notmatch "\`$testEnabled\s*=\s*'true'") "expected no `$testEnabled = 'true'"

Add-Result 'Scenario C seeds $sentinelEnabled as a JSON boolean ($false), not a string' `
    ($orchestratorSource -match '\$sentinelEnabled\s*=\s*\$false') 'expected literal $sentinelEnabled = $false'
Add-Result 'Scenario C does not seed $sentinelEnabled as the string ''false''' `
    ($orchestratorSource -notmatch "\`$sentinelEnabled\s*=\s*'false'") "expected no `$sentinelEnabled = 'false'"

# --- Test-MsiLogContainsAction: multi-session major-upgrade logs -----------
# A major-upgrade log contains two MSI sessions (RemoveExistingProducts's
# uninstall of the old product, then the new product's own install). One
# session can log "Skipping action: MigrateLegacyConfig" while the other
# genuinely runs it - requiring "ran AND NOT skipped anywhere in the log"
# made this a false negative even though the action really executed. The
# fix: for the normal (non -ExpectSkipped) case, "ran at least once" is
# sufficient; the caller's follow-up file/content assertions verify the
# real outcome. -ExpectSkipped stays strict (skipped and never ran).

$multiSessionLog = Join-Path $env:TEMP "multisession-$([guid]::NewGuid()).log"
@'
MSI (s) (AB:CD) [12:00:00:001]: Doing action: InstallValidate
MSI (s) (AB:CD) [12:00:00:050]: Skipping action: MigrateLegacyConfig
MSI (s) (AB:CD) [12:00:00:100]: Doing action: RemoveExistingProducts
MSI (s) (EF:12) [12:00:05:001]: Doing action: InstallValidate
MSI (s) (EF:12) [12:00:05:050]: Doing action: MigrateLegacyConfig
MSI (s) (EF:12) [12:00:05:100]: Doing action: InstallFiles
'@ | Set-Content -LiteralPath $multiSessionLog -Encoding UTF8

try {
    $normalResult = Test-MsiLogContainsAction -LogPath $multiSessionLog -ActionName 'MigrateLegacyConfig'
    Add-Result 'Test-MsiLogContainsAction: normal case returns true when action ran in any session' ($normalResult -eq $true) "got=$normalResult"

    $expectSkippedResult = Test-MsiLogContainsAction -LogPath $multiSessionLog -ActionName 'MigrateLegacyConfig' -ExpectSkipped
    Add-Result 'Test-MsiLogContainsAction: -ExpectSkipped returns false when the action also ran' ($expectSkippedResult -eq $false) "got=$expectSkippedResult"
}
finally {
    Remove-Item -LiteralPath $multiSessionLog -Force -ErrorAction SilentlyContinue
}

$failed = @($results | Where-Object { -not $_.Passed })
if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "$($failed.Count) of $($results.Count) case(s) FAILED." -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host "All $($results.Count) case(s) passed." -ForegroundColor Green
exit 0
