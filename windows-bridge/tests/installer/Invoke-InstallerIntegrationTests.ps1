<#
.SYNOPSIS
    NoraMedi Bridge installer integration harness. Drives real msiexec
    install/upgrade/repair/uninstall cycles against the built MSIs and
    asserts filesystem/registry/service/config/version state, specifically
    to prove the MigrateLegacyConfig legacy-config-preservation fix behaves
    correctly on real Windows (the fix that AppSearch-gating failed to
    deliver on the 0.4.4 -> 0.4.5 physical retest).

    THIS SCRIPT MUTATES THE MACHINE IT RUNS ON: it installs and removes a
    real Windows Service (NoraMediBridge), writes to
    %ProgramFiles%\NoraMedi\Bridge and %ProgramData%\NoraMediBridge, and
    touches HKLM. Run it only on a disposable Windows test machine or a
    dedicated physical bridge test box you're prepared to have altered by
    a real install/upgrade/uninstall cycle. Never point it at a machine
    holding production clinic data.

.DESCRIPTION
    Scenarios (see README.md for the full narrative):
      A - Clean install of the candidate version.
      B - Legacy-layout upgrade: install previous version, hand-edit the
          legacy Program Files appsettings.json, upgrade, verify the
          ProgramData override was created with the legacy values before
          the legacy file was overwritten.
      C - Existing override: a ProgramData override already exists;
          upgrade/repair must never overwrite it.
      D - Failure/rollback: the destination cannot be created; the upgrade
          must fail (non-zero exit), roll back, and leave the previous
          version installed and the legacy config intact.
      E - Repair and uninstall of the candidate version.

    Every scenario writes a JSON block to the run's results.json and a
    human-readable line to results.txt. The script's own exit code is 0
    only if every scenario that was asked to run reported Pass.

.PARAMETER PreviousMsiPath
    Path to the previously-shipped MSI (e.g. NoraMediBridge 0.4.5).

.PARAMETER PreviousVersion
    Version string of PreviousMsiPath, e.g. "0.4.5". Used only for logging
    and result labeling, not for parsing the MSI.

.PARAMETER PreviousMsiSha256
    Expected SHA-256 of PreviousMsiPath. The script refuses to run if the
    file on disk does not match, so a stale or tampered artifact can never
    be silently substituted.

.PARAMETER CandidateMsiPath
    Path to the MSI under test (e.g. NoraMediBridge 0.4.6).

.PARAMETER CandidateVersion
    Version string of CandidateMsiPath, e.g. "0.4.6".

.PARAMETER CandidateMsiSha256
    Expected SHA-256 of CandidateMsiPath.

.PARAMETER WorkingDirectory
    Root directory for timestamped run logs/snapshots. Defaults to
    "<script directory>\_runs".

.PARAMETER Scenario
    Which scenario(s) to run: A, B, C, D, E, or All (default). Repeatable.

.PARAMETER RunDestructiveTests
    Required to run Scenario D (simulated failure/rollback) and the
    optional REMOVE_LOCAL_DATA=1 sub-case of Scenario E. Without this
    switch those steps are skipped, not silently downgraded to a no-op
    pass.

.PARAMETER Force
    Suppresses the interactive Y/N confirmation prompt that otherwise
    precedes every destructive step (install/upgrade/uninstall). Intended
    for a human operator to omit on first run and only pass once they've
    read the plan printed at the top of output.

.EXAMPLE
    # Preflight only: verify hashes, elevation, and current machine state
    # without installing anything.
    .\Invoke-InstallerIntegrationTests.ps1 -PreviousMsiPath C:\artifacts\0.4.5\NoraMediBridge.msi -PreviousVersion 0.4.5 -PreviousMsiSha256 <sha> `
        -CandidateMsiPath C:\artifacts\0.4.6\NoraMediBridge.msi -CandidateVersion 0.4.6 -CandidateMsiSha256 <sha> `
        -Scenario Preflight

.EXAMPLE
    # Run every scenario except the destructive one.
    .\Invoke-InstallerIntegrationTests.ps1 -PreviousMsiPath ... -CandidateMsiPath ... -PreviousVersion 0.4.5 -CandidateVersion 0.4.6 `
        -PreviousMsiSha256 <sha> -CandidateMsiSha256 <sha> -Scenario A,B,C,E

.EXAMPLE
    # Full run including the destructive failure/rollback scenario.
    .\Invoke-InstallerIntegrationTests.ps1 -PreviousMsiPath ... -CandidateMsiPath ... -PreviousVersion 0.4.5 -CandidateVersion 0.4.6 `
        -PreviousMsiSha256 <sha> -CandidateMsiSha256 <sha> -Scenario All -RunDestructiveTests
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$PreviousMsiPath,
    [Parameter(Mandatory)][string]$PreviousVersion,
    [Parameter(Mandatory)][string]$PreviousMsiSha256,

    [Parameter(Mandatory)][string]$CandidateMsiPath,
    [Parameter(Mandatory)][string]$CandidateVersion,
    [Parameter(Mandatory)][string]$CandidateMsiSha256,

    [string]$WorkingDirectory = (Join-Path $PSScriptRoot '_runs'),

    [ValidateSet('Preflight', 'A', 'B', 'C', 'D', 'E', 'All')]
    [string[]]$Scenario = @('All'),

    [switch]$RunDestructiveTests,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'InstallerTestHelpers.psm1') -Force

if ($Scenario -contains 'All') {
    $Scenario = @('A', 'B', 'C', 'D', 'E')
}

function Assert-FileHash {
    param([string]$Path, [string]$Expected, [string]$Label)
    if (-not (Test-Path $Path)) { throw "$Label not found at '$Path'." }
    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
    if ($actual.ToLowerInvariant() -ne $Expected.ToLowerInvariant()) {
        throw "$Label SHA-256 mismatch. Expected $Expected, got $actual. Refusing to run against an unverified artifact."
    }
}

# Confirm-DestructiveStep, Uninstall-IfPresent, Reset-ScenarioState, and
# Install-CandidateIfNeeded live in InstallerTestHelpers.psm1 (not here) so
# StateMachine.Tests.ps1 can exercise the order-independence logic with
# mocked Get-InstalledNoraMediProduct/Invoke-MsiProcess/Test-Path, without
# needing a real msiexec run. Every call site below passes -Force:$Force
# explicitly since module functions don't see this script's $Force by
# closure the way same-file functions would.

function Invoke-ScenarioA {
    param([string]$RunDir)
    $result = New-ScenarioResult -Name 'A: Clean install'
    $result.LogDir = $RunDir
    try {
        # Order-independent: a clean install means both no product AND no
        # leftover ProgramData override, regardless of what an earlier
        # scenario in this same run (B, C, D, E) left behind.
        Reset-ScenarioState -ScenarioName 'Scenario A' -RunDir $RunDir -LogNamePrefix 'A' -RemoveProgramData -Force:$Force

        Add-ScenarioAssertion -Result $result -Name 'No prior product installed' -Condition (-not (Get-InstalledNoraMediProduct)) -Detail 'checked Uninstall registry key'
        Add-ScenarioAssertion -Result $result -Name 'Program Files path absent' -Condition (-not (Test-Path $ProgramFilesInstallDir)) -Detail $ProgramFilesInstallDir
        Add-ScenarioAssertion -Result $result -Name 'No ProgramData override left over from a prior scenario' -Condition (-not (Test-Path $ProgramDataRoot)) -Detail $ProgramDataRoot

        $install = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'A-install'
        Add-ScenarioAssertion -Result $result -Name 'Clean install exit code 0' -Condition ($install.ExitCode -eq 0) -Detail "exit=$($install.ExitCode) log=$($install.LogPath)"

        Add-ScenarioAssertion -Result $result -Name 'MigrateLegacyConfig did not run on clean install' `
            -Condition (Test-MsiLogContainsAction -LogPath $install.LogPath -ActionName 'MigrateLegacyConfig' -ExpectSkipped) `
            -Detail 'expected "Skipping action: MigrateLegacyConfig" (WIX_UPGRADE_DETECTED is not set on a clean install)'

        $svcExe = Join-Path $ProgramFilesInstallDir 'Service\NoraMediBridge.Service.exe'
        $mgrExe = Join-Path $ProgramFilesInstallDir 'Manager\NoraMediBridge.Manager.exe'
        $svcVersion = Get-FileVersionDetails -Path $svcExe
        $mgrVersion = Get-FileVersionDetails -Path $mgrExe
        Add-ScenarioAssertion -Result $result -Name 'Service FileVersion matches candidate' -Condition ($svcVersion.FileVersion -like "$CandidateVersion*") -Detail $svcVersion.FileVersion
        Add-ScenarioAssertion -Result $result -Name 'Manager FileVersion matches candidate' -Condition ($mgrVersion.FileVersion -like "$CandidateVersion*") -Detail $mgrVersion.FileVersion

        Start-Sleep -Seconds 3
        $svcState = Get-NoraMediServiceState
        Add-ScenarioAssertion -Result $result -Name 'Service is registered' -Condition $svcState.Exists -Detail ($svcState | ConvertTo-Json -Compress)
        Add-ScenarioAssertion -Result $result -Name 'Service StartType is Automatic' -Condition ($svcState.StartType -eq 'Automatic') -Detail $svcState.StartType

        $packagedEnabled = Get-JsonConfigValue -Path (Join-Path $ProgramFilesInstallDir 'Service\appsettings.json') -Section 'BridgeSelfService' -Key 'Enabled'
        Add-ScenarioAssertion -Result $result -Name 'Packaged default is disabled until paired' -Condition ($packagedEnabled -eq $false -or $null -eq $packagedEnabled) -Detail "Enabled=$packagedEnabled"

        Complete-ScenarioResult -Result $result -Status 'Pass' | Out-Null
    }
    catch {
        $result.Notes.Add("Exception: $($_.Exception.Message)")
        Complete-ScenarioResult -Result $result -Status 'Fail' | Out-Null
    }
    return $result
}

function Invoke-ScenarioB {
    param([string]$RunDir)
    $result = New-ScenarioResult -Name 'B: Legacy-layout upgrade preserves customized config'
    $result.LogDir = $RunDir
    $testEnabled = $true
    $testServerUrl = 'http://127.0.0.1:5000'
    $testPipeName = 'NoraMediBridge-Test'
    try {
        # Order-independent: this scenario's whole premise is "no
        # ProgramData override exists yet", so make that true rather than
        # assume it and throw - a prior scenario in the same run (A, C, D, E)
        # may well have left a product installed and/or an override behind.
        Reset-ScenarioState -ScenarioName 'Scenario B' -RunDir $RunDir -LogNamePrefix 'B' -RemoveProgramData -Force:$Force

        Confirm-DestructiveStep -Force:$Force -Message "Scenario B will install $PreviousVersion, hand-edit its legacy config, then upgrade to $CandidateVersion."
        $installPrev = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$PreviousMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'B-install-previous'
        Add-ScenarioAssertion -Result $result -Name "Previous version ($PreviousVersion) installs cleanly" -Condition ($installPrev.ExitCode -eq 0) -Detail "exit=$($installPrev.ExitCode)"

        Add-ScenarioAssertion -Result $result -Name 'No ProgramData override exists yet' -Condition (-not (Test-Path $ProgramDataConfigPath)) -Detail $ProgramDataConfigPath

        # Stop the service before hand-editing its config, then restart so the
        # edit reflects "an operator customized this running install", not a
        # value the service would otherwise have overwritten.
        Stop-Service -Name $NoraMediServiceName -Force -ErrorAction SilentlyContinue
        $legacyJson = Get-Content -LiteralPath $LegacyServiceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $legacyJson.BridgeSelfService) {
            $legacyJson | Add-Member -NotePropertyName BridgeSelfService -NotePropertyValue ([pscustomobject]@{})
        }
        $legacyJson.BridgeSelfService | Add-Member -NotePropertyName Enabled -NotePropertyValue $testEnabled -Force
        $legacyJson.BridgeSelfService | Add-Member -NotePropertyName ServerUrl -NotePropertyValue $testServerUrl -Force
        $legacyJson.BridgeSelfService | Add-Member -NotePropertyName PipeName -NotePropertyValue $testPipeName -Force
        ($legacyJson | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $LegacyServiceConfigPath -Encoding utf8
        Write-TestLog "Hand-edited legacy config at $LegacyServiceConfigPath with distinctive test values." -Level INFO

        $upgrade = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'B-upgrade'
        Add-ScenarioAssertion -Result $result -Name "Upgrade to $CandidateVersion exit code 0" -Condition ($upgrade.ExitCode -eq 0) -Detail "exit=$($upgrade.ExitCode) log=$($upgrade.LogPath)"

        Add-ScenarioAssertion -Result $result -Name 'MigrateLegacyConfig ran (not skipped) during the upgrade' `
            -Condition (Test-MsiLogContainsAction -LogPath $upgrade.LogPath -ActionName 'MigrateLegacyConfig') `
            -Detail 'expected "Doing action: MigrateLegacyConfig" - WIX_UPGRADE_DETECTED must be true for a real version-to-version upgrade'

        Add-ScenarioAssertion -Result $result -Name 'ProgramData override was created' -Condition (Test-Path $ProgramDataConfigPath) -Detail $ProgramDataConfigPath

        $migratedEnabled = Get-JsonConfigValue -Path $ProgramDataConfigPath -Section 'BridgeSelfService' -Key 'Enabled'
        $migratedServerUrl = Get-JsonConfigValue -Path $ProgramDataConfigPath -Section 'BridgeSelfService' -Key 'ServerUrl'
        $migratedPipeName = Get-JsonConfigValue -Path $ProgramDataConfigPath -Section 'BridgeSelfService' -Key 'PipeName'
        Add-ScenarioAssertion -Result $result -Name 'Migrated Enabled matches hand-edited value' -Condition ($migratedEnabled -eq $testEnabled) -Detail "got=$migratedEnabled want=$testEnabled"
        Add-ScenarioAssertion -Result $result -Name 'Migrated ServerUrl matches hand-edited value' -Condition ($migratedServerUrl -eq $testServerUrl) -Detail "got=$migratedServerUrl want=$testServerUrl"
        Add-ScenarioAssertion -Result $result -Name 'Migrated PipeName matches hand-edited value' -Condition ($migratedPipeName -eq $testPipeName) -Detail "got=$migratedPipeName want=$testPipeName"

        $svcVersion = Get-FileVersionDetails -Path (Join-Path $ProgramFilesInstallDir 'Service\NoraMediBridge.Service.exe')
        Add-ScenarioAssertion -Result $result -Name 'Service FileVersion matches candidate after upgrade' -Condition ($svcVersion.FileVersion -like "$CandidateVersion*") -Detail $svcVersion.FileVersion

        Start-Service -Name $NoraMediServiceName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        $svcState = Get-NoraMediServiceState
        Add-ScenarioAssertion -Result $result -Name 'Service starts successfully after migration' -Condition ($svcState.Status -eq 'Running') -Detail ($svcState | ConvertTo-Json -Compress)

        # Physical proof, not just a JSON-file inspection: the running
        # process must actually bind the named pipe corresponding to the
        # migrated ProgramData PipeName, not the packaged appsettings.json's
        # value. This is the exact real-hardware finding that JSON-only
        # assertions above missed - ProgramDataConfigOverride.Apply used to
        # match the *first* EnvironmentVariablesConfigurationSource in
        # Host.CreateApplicationBuilder's source list, which is an early
        # DOTNET_-prefixed bootstrap source inserted *before* appsettings.json,
        # not the real unprefixed one added after it - so the override landed
        # at the wrong precedence and the packaged "NoraMediBridge-Test" value
        # won instead of the migrated "NoraMediBridge" value. Poll briefly
        # since the pipe server starts asynchronously in Worker.StartAsync.
        $expectedPipe = $migratedPipeName
        $pipeFound = $false
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            $openPipes = [System.IO.Directory]::GetFiles('\\.\pipe\')
            if ($openPipes -contains "\\.\pipe\$expectedPipe") { $pipeFound = $true; break }
            Start-Sleep -Milliseconds 500
        }
        Add-ScenarioAssertion -Result $result -Name 'Running service opened the migrated named pipe (not the packaged default)' `
            -Condition $pipeFound -Detail "expected pipe '\\.\pipe\$expectedPipe' to be open; found: $(([System.IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -like '*NoraMedi*' }) -join ', ')"

        $packagedPipeName = Get-JsonConfigValue -Path (Join-Path $ProgramFilesInstallDir 'Service\appsettings.json') -Section 'BridgeSelfService' -Key 'PipeName'
        if ($packagedPipeName -and $packagedPipeName -ne $expectedPipe) {
            $wrongPipeOpen = ([System.IO.Directory]::GetFiles('\\.\pipe\')) -contains "\\.\pipe\$packagedPipeName"
            Add-ScenarioAssertion -Result $result -Name 'Service did NOT open the packaged (pre-migration) pipe name' -Condition (-not $wrongPipeOpen) -Detail "packaged PipeName='$packagedPipeName'"
        }

        Complete-ScenarioResult -Result $result -Status 'Pass' | Out-Null
    }
    catch {
        $result.Notes.Add("Exception: $($_.Exception.Message)")
        Complete-ScenarioResult -Result $result -Status 'Fail' | Out-Null
    }
    return $result
}

function Invoke-ScenarioC {
    param([string]$RunDir)
    $result = New-ScenarioResult -Name 'C: Existing ProgramData override is never overwritten'
    $result.LogDir = $RunDir
    $sentinelEnabled = $false
    $sentinelServerUrl = 'https://sentinel.invalid.test'
    try {
        # Order-independent: ensures the candidate is installed regardless
        # of what an earlier scenario left behind (nothing installed, the
        # candidate already installed, or a stale previous-version install
        # left by B/D). Always creates its own distinctive sentinel override
        # below, overwriting anything an earlier scenario put there, since
        # this scenario's assertion is specifically about *this* value
        # surviving a repair, not about what came before it.
        Install-CandidateIfNeeded -Result $result -ScenarioName 'Scenario C' -RunDir $RunDir -LogNamePrefix 'C' -CandidateMsiPath $CandidateMsiPath -CandidateVersion $CandidateVersion -Force:$Force

        New-Item -ItemType Directory -Path (Split-Path $ProgramDataConfigPath -Parent) -Force | Out-Null
        @{ BridgeSelfService = @{ Enabled = $sentinelEnabled; ServerUrl = $sentinelServerUrl } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ProgramDataConfigPath -Encoding utf8
        Write-TestLog "Seeded sentinel ProgramData override at $ProgramDataConfigPath (overwriting any override left by an earlier scenario)." -Level INFO

        Confirm-DestructiveStep -Force:$Force -Message "Scenario C will repair $CandidateVersion in place (msiexec /fa) and check the sentinel override survives."
        $repair = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/fa', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'C-repair'
        Add-ScenarioAssertion -Result $result -Name 'Repair exit code 0' -Condition ($repair.ExitCode -eq 0) -Detail "exit=$($repair.ExitCode) log=$($repair.LogPath)"

        Add-ScenarioAssertion -Result $result -Name 'MigrateLegacyConfig did not run on repair' `
            -Condition (Test-MsiLogContainsAction -LogPath $repair.LogPath -ActionName 'MigrateLegacyConfig' -ExpectSkipped) `
            -Detail 'expected skipped - WIX_UPGRADE_DETECTED is not set for a same-version repair (no older version exists to detect)'

        $afterEnabled = Get-JsonConfigValue -Path $ProgramDataConfigPath -Section 'BridgeSelfService' -Key 'Enabled'
        $afterServerUrl = Get-JsonConfigValue -Path $ProgramDataConfigPath -Section 'BridgeSelfService' -Key 'ServerUrl'
        Add-ScenarioAssertion -Result $result -Name 'Sentinel Enabled untouched by repair' -Condition ($afterEnabled -eq $sentinelEnabled) -Detail "got=$afterEnabled want=$sentinelEnabled"
        Add-ScenarioAssertion -Result $result -Name 'Sentinel ServerUrl untouched by repair' -Condition ($afterServerUrl -eq $sentinelServerUrl) -Detail "got=$afterServerUrl want=$sentinelServerUrl"

        Complete-ScenarioResult -Result $result -Status 'Pass' | Out-Null
    }
    catch {
        $result.Notes.Add("Exception: $($_.Exception.Message)")
        Complete-ScenarioResult -Result $result -Status 'Fail' | Out-Null
    }
    return $result
}

function Invoke-ScenarioD {
    param([string]$RunDir)
    $result = New-ScenarioResult -Name 'D: Migration failure forces rollback'
    $result.LogDir = $RunDir
    if (-not $RunDestructiveTests) {
        $result.Notes.Add('Skipped: pass -RunDestructiveTests to run Scenario D.')
        return (Complete-ScenarioResult -Result $result -Status 'Skipped')
    }
    $configDir = Split-Path $ProgramDataConfigPath -Parent
    $aclBackup = $null
    try {
        # Order-independent: same "no ProgramData override yet" precondition
        # as Scenario B, made true rather than assumed - a prior scenario
        # (A, B, C, E) in the same run may have left a product and/or an
        # override behind.
        Reset-ScenarioState -ScenarioName 'Scenario D' -RunDir $RunDir -LogNamePrefix 'D' -RemoveProgramData -Force:$Force

        Confirm-DestructiveStep -Force:$Force -Message "Scenario D will install $PreviousVersion, then make the ProgramData config *directory* path unwritable (by pre-creating it as a file, not a directory) so MigrateLegacyConfig's mkdir/copy fails, then upgrade and confirm rollback."
        $installPrev = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$PreviousMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'D-install-previous'
        Add-ScenarioAssertion -Result $result -Name "Previous version ($PreviousVersion) installs cleanly" -Condition ($installPrev.ExitCode -eq 0) -Detail "exit=$($installPrev.ExitCode)"

        # Force the failure deterministically and reversibly, scoped only to
        # this one NoraMedi path: pre-create "...\NoraMediBridge\config" as an
        # ordinary FILE (not a directory). The deferred command's own
        # `if not exist "...\config\" mkdir "...\config\"` then fails because
        # a file already occupies that name, so the subsequent `copy` never
        # runs and the command's `|| exit /b 1` fires. This never touches any
        # ACL and cannot affect anything outside this one NoraMedi path.
        $noraMediDataRoot = Split-Path $configDir -Parent
        New-Item -ItemType Directory -Path $noraMediDataRoot -Force | Out-Null
        if (Test-Path $configDir) { Remove-Item -LiteralPath $configDir -Recurse -Force }
        New-Item -ItemType File -Path $configDir -Force | Out-Null
        Write-TestLog "Blocked '$configDir' by occupying that path with a file, to force MigrateLegacyConfig's mkdir to fail." -Level WARN

        $upgrade = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'D-upgrade-expected-fail'
        Add-ScenarioAssertion -Result $result -Name 'Upgrade fails with non-zero exit code' -Condition ($upgrade.ExitCode -ne 0) -Detail "exit=$($upgrade.ExitCode)"

        Add-ScenarioAssertion -Result $result -Name 'MSI log shows rollback was invoked' `
            -Condition ((Get-Content -Path $upgrade.LogPath -Raw -Encoding UTF8) -match 'Action ended[^\r\n]*Rollback' -or (Get-Content -Path $upgrade.LogPath -Raw -Encoding UTF8) -match 'Doing action:\s+RollbackCleanup') `
            -Detail 'searched for a Rollback action entry in the verbose MSI log'

        Start-Sleep -Seconds 2
        $installedAfter = Get-InstalledNoraMediProduct
        Add-ScenarioAssertion -Result $result -Name "Previous version ($PreviousVersion) remains installed after rollback" -Condition ($installedAfter -and $installedAfter.DisplayVersion -eq $PreviousVersion) -Detail ($installedAfter | ConvertTo-Json -Compress)

        Start-Sleep -Seconds 2
        $svcState = Get-NoraMediServiceState
        Add-ScenarioAssertion -Result $result -Name 'Service is still operational after rollback' -Condition ($svcState.Exists) -Detail ($svcState | ConvertTo-Json -Compress)

        Complete-ScenarioResult -Result $result -Status 'Pass' | Out-Null
    }
    catch {
        $result.Notes.Add("Exception: $($_.Exception.Message)")
        Complete-ScenarioResult -Result $result -Status 'Fail' | Out-Null
    }
    finally {
        # Always undo the artificial blocker, even if an assertion threw.
        try {
            if ((Test-Path $configDir) -and -not (Get-Item -LiteralPath $configDir).PSIsContainer) {
                Remove-Item -LiteralPath $configDir -Force -ErrorAction SilentlyContinue
                Write-TestLog "Restored '$configDir' (removed the blocking file)." -Level INFO
            }
        }
        catch {
            Write-TestLog "Cleanup of blocker at '$configDir' failed: $($_.Exception.Message). Remove it by hand before the next run." -Level ERROR
        }
    }
    return $result
}

function Invoke-ScenarioE {
    param([string]$RunDir)
    $result = New-ScenarioResult -Name 'E: Repair and uninstall'
    $result.LogDir = $RunDir
    try {
        # Order-independent: ensures the candidate is installed regardless
        # of what an earlier scenario left behind, the same as Scenario C.
        Install-CandidateIfNeeded -Result $result -ScenarioName 'Scenario E' -RunDir $RunDir -LogNamePrefix 'E' -CandidateMsiPath $CandidateMsiPath -CandidateVersion $CandidateVersion -Force:$Force

        # This scenario must not depend on B/C/D having left a ProgramData
        # override behind - seed its own if none exists yet, so "the
        # override survives repair/uninstall" is proven by this scenario
        # alone, not by a coincidence of run order.
        if (-not (Test-Path $ProgramDataConfigPath)) {
            New-Item -ItemType Directory -Path (Split-Path $ProgramDataConfigPath -Parent) -Force | Out-Null
            @{ BridgeSelfService = @{ Enabled = $true; ServerUrl = 'http://scenario-e-seed.invalid' } } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ProgramDataConfigPath -Encoding utf8
            Write-TestLog "Scenario E: no ProgramData override existed yet; seeded one so this scenario is self-contained." -Level INFO
        }

        $overrideBefore = if (Test-Path $ProgramDataConfigPath) { Get-Content -LiteralPath $ProgramDataConfigPath -Raw -Encoding UTF8 } else { $null }

        Confirm-DestructiveStep -Force:$Force -Message "Scenario E will repair $CandidateVersion in place (msiexec /fa)."
        $repair = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/fa', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'E-repair'
        Add-ScenarioAssertion -Result $result -Name 'Repair exit code 0' -Condition ($repair.ExitCode -eq 0) -Detail "exit=$($repair.ExitCode)"

        $overrideAfterRepair = if (Test-Path $ProgramDataConfigPath) { Get-Content -LiteralPath $ProgramDataConfigPath -Raw -Encoding UTF8 } else { $null }
        Add-ScenarioAssertion -Result $result -Name 'ProgramData override unchanged by repair' -Condition ($overrideBefore -eq $overrideAfterRepair) -Detail 'byte-compared override file content before/after repair'

        Start-Sleep -Seconds 2
        $svcAfterRepair = Get-NoraMediServiceState
        Add-ScenarioAssertion -Result $result -Name 'Service registration valid after repair' -Condition $svcAfterRepair.Exists -Detail ($svcAfterRepair | ConvertTo-Json -Compress)

        $productBeforeUninstall = Get-InstalledNoraMediProduct
        Confirm-DestructiveStep -Force:$Force -Message "Scenario E will now uninstall $CandidateVersion (normal uninstall, ProgramData is expected to survive by design)."
        $uninstall = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/x', $productBeforeUninstall.ProductCode, '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'E-uninstall'
        Add-ScenarioAssertion -Result $result -Name 'Uninstall exit code 0' -Condition ($uninstall.ExitCode -eq 0) -Detail "exit=$($uninstall.ExitCode)"

        Add-ScenarioAssertion -Result $result -Name 'Program Files install directory removed' -Condition (-not (Test-Path $ProgramFilesInstallDir)) -Detail $ProgramFilesInstallDir
        Add-ScenarioAssertion -Result $result -Name 'Service unregistered' -Condition (-not (Get-NoraMediServiceState).Exists) -Detail 'Get-Service should return nothing'
        Add-ScenarioAssertion -Result $result -Name 'ProgramData override survives normal uninstall (documented default)' -Condition (Test-Path $ProgramDataConfigPath) -Detail $ProgramDataConfigPath

        if ($RunDestructiveTests) {
            Confirm-DestructiveStep -Force:$Force -Message "Optional destructive sub-case: reinstall $CandidateVersion then uninstall with REMOVE_LOCAL_DATA=1 to verify full ProgramData removal."
            $reinstall = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName 'E-reinstall-for-remove-local-data'
            Add-ScenarioAssertion -Result $result -Name 'Reinstall before REMOVE_LOCAL_DATA case exit code 0' -Condition ($reinstall.ExitCode -eq 0) -Detail "exit=$($reinstall.ExitCode)"

            $productForRemoval = Get-InstalledNoraMediProduct
            $removeAll = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/x', $productForRemoval.ProductCode, '/quiet', '/norestart', 'REMOVE_LOCAL_DATA=1') -LogDirectory $RunDir -LogName 'E-uninstall-remove-local-data'
            Add-ScenarioAssertion -Result $result -Name 'REMOVE_LOCAL_DATA=1 uninstall exit code 0' -Condition ($removeAll.ExitCode -eq 0) -Detail "exit=$($removeAll.ExitCode)"
            Add-ScenarioAssertion -Result $result -Name 'ProgramData tree removed with REMOVE_LOCAL_DATA=1' -Condition (-not (Test-Path (Split-Path $ProgramDataConfigPath -Parent))) -Detail (Split-Path $ProgramDataConfigPath -Parent)
        }
        else {
            $result.Notes.Add('REMOVE_LOCAL_DATA=1 sub-case skipped: pass -RunDestructiveTests to run it.')
        }

        Complete-ScenarioResult -Result $result -Status 'Pass' | Out-Null
    }
    catch {
        $result.Notes.Add("Exception: $($_.Exception.Message)")
        Complete-ScenarioResult -Result $result -Status 'Fail' | Out-Null
    }
    return $result
}

# ---------------------------------------------------------------------------

Assert-Administrator

$runDir = New-TestRunDirectory -WorkingDirectory $WorkingDirectory
$runLogFile = Join-Path $runDir 'harness.log'
Write-TestLog "NoraMedi Bridge installer integration harness starting." -Level INFO -RunLogFile $runLogFile
Write-TestLog "Run directory: $runDir" -Level INFO -RunLogFile $runLogFile
Write-TestLog "Previous: $PreviousVersion @ $PreviousMsiPath" -Level INFO -RunLogFile $runLogFile
Write-TestLog "Candidate: $CandidateVersion @ $CandidateMsiPath" -Level INFO -RunLogFile $runLogFile
Write-TestLog "Scenarios requested: $($Scenario -join ', ')" -Level INFO -RunLogFile $runLogFile
if ($RunDestructiveTests) {
    Write-TestLog "Destructive tests ENABLED (-RunDestructiveTests): Scenario D and the REMOVE_LOCAL_DATA sub-case of Scenario E will run." -Level WARN -RunLogFile $runLogFile
}
else {
    Write-TestLog "Destructive tests disabled: Scenario D and the REMOVE_LOCAL_DATA sub-case of Scenario E will be skipped. Pass -RunDestructiveTests to include them." -Level INFO -RunLogFile $runLogFile
}

Assert-FileHash -Path $PreviousMsiPath -Expected $PreviousMsiSha256 -Label 'Previous MSI'
Assert-FileHash -Path $CandidateMsiPath -Expected $CandidateMsiSha256 -Label 'Candidate MSI'
Write-TestLog "Both MSI hashes verified." -Level PASS -RunLogFile $runLogFile

# Arm machine mutation (msiexec / uninstall / ProgramData deletion) only now
# that elevation is confirmed, both hashes verified, and only if a
# non-Preflight scenario was actually requested. A Preflight-only run never
# arms mutation, so Invoke-MsiProcess/Uninstall-IfPresent/Reset-ScenarioState/
# Install-CandidateIfNeeded/Remove-NoraMediProgramDataTree all refuse to run
# below even if a future code path accidentally tried to call them.
$requestedNonPreflightScenarios = @($Scenario | Where-Object { $_ -ne 'Preflight' })
if ($requestedNonPreflightScenarios.Count -gt 0) {
    Enable-HarnessMutation
    Write-TestLog "Machine mutation ARMED: non-Preflight scenario(s) requested ($($requestedNonPreflightScenarios -join ', '))." -Level WARN -RunLogFile $runLogFile
}
else {
    Write-TestLog "Machine mutation NOT armed: Preflight-only run performs no installs/upgrades/uninstalls." -Level INFO -RunLogFile $runLogFile
}

Backup-NoraMediConfigState -Destination (Join-Path $runDir 'snapshots\pre-run')

$allResults = New-Object System.Collections.Generic.List[object]

if ($Scenario -contains 'Preflight') {
    Write-TestLog "Preflight-only run: hashes verified, no installs/upgrades/uninstalls performed." -Level PASS -RunLogFile $runLogFile

    $installedProduct = Get-InstalledNoraMediProduct
    if ($installedProduct) {
        Write-TestLog "Installed product: NoraMedi Bridge $($installedProduct.DisplayVersion) ($($installedProduct.ProductCode))." -Level INFO -RunLogFile $runLogFile
    }
    else {
        Write-TestLog "Installed product: none." -Level INFO -RunLogFile $runLogFile
    }

    $svcState = Get-NoraMediServiceState
    $svcDetail = if ($svcState.Exists) { "exists, Status=$($svcState.Status), StartType=$($svcState.StartType)" } else { 'not registered' }
    Write-TestLog "Service '$NoraMediServiceName': $svcDetail." -Level INFO -RunLogFile $runLogFile

    $programFilesDetail = if (Test-Path $ProgramFilesInstallDir) { 'present' } else { 'absent' }
    Write-TestLog "Program Files install directory ($ProgramFilesInstallDir): $programFilesDetail." -Level INFO -RunLogFile $runLogFile

    $programDataDetail = if (Test-Path $ProgramDataRoot) { 'present' } else { 'absent' }
    Write-TestLog "ProgramData override root ($ProgramDataRoot): $programDataDetail." -Level INFO -RunLogFile $runLogFile

    $Scenario = @()
}

foreach ($s in $Scenario) {
    Write-TestLog "==== Scenario $s starting ====" -Level INFO -RunLogFile $runLogFile
    $scenarioResult = switch ($s) {
        'A' { Invoke-ScenarioA -RunDir $runDir }
        'B' { Invoke-ScenarioB -RunDir $runDir }
        'C' { Invoke-ScenarioC -RunDir $runDir }
        'D' { Invoke-ScenarioD -RunDir $runDir }
        'E' { Invoke-ScenarioE -RunDir $runDir }
    }
    $allResults.Add($scenarioResult)
    Write-TestLog "==== Scenario $s finished: $($scenarioResult.Status) ====" -Level $(if ($scenarioResult.Status -eq 'Pass') { 'PASS' } elseif ($scenarioResult.Status -eq 'Skipped') { 'WARN' } else { 'FAIL' }) -RunLogFile $runLogFile
}

$summaryPath = Join-Path $runDir 'results.json'
$textSummaryPath = Join-Path $runDir 'results.txt'
$allResults | ConvertTo-Json -Depth 10 | Set-Content -Path $summaryPath -Encoding utf8

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("NoraMedi Bridge installer integration harness - results")
$lines.Add("Run directory: $runDir")
$lines.Add("Previous: $PreviousVersion, Candidate: $CandidateVersion")
$lines.Add("")
foreach ($r in $allResults) {
    $lines.Add("[$($r.Status.ToUpperInvariant())] $($r.Scenario)")
    foreach ($a in $r.Assertions) {
        $mark = if ($a.Passed) { 'ok' } else { 'FAIL' }
        $detailSuffix = if ($a.Detail) { "- $($a.Detail)" } else { '' }
        $lines.Add("    - [$mark] $($a.Name) $detailSuffix")
    }
    foreach ($n in $r.Notes) {
        $lines.Add("    note: $n")
    }
}
$lines | Set-Content -Path $textSummaryPath -Encoding utf8
Get-Content -Path $textSummaryPath | Write-Host

Write-TestLog "JSON summary: $summaryPath" -Level INFO -RunLogFile $runLogFile
Write-TestLog "Text summary: $textSummaryPath" -Level INFO -RunLogFile $runLogFile

$failed = @($allResults | Where-Object { $_.Status -eq 'Fail' })
if ($failed.Count -gt 0) {
    Write-TestLog "$($failed.Count) scenario(s) FAILED." -Level FAIL -RunLogFile $runLogFile
    exit 1
}
Write-TestLog "All requested scenarios passed (or were explicitly skipped)." -Level PASS -RunLogFile $runLogFile
exit 0
