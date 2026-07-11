#Requires -Version 5.1
<#
Shared helpers for the NoraMedi Bridge installer integration harness
(Invoke-InstallerIntegrationTests.ps1). Every function here is written to be
safe to call repeatedly and to fail loudly (throw) rather than warn, because
the orchestrator treats an uncaught exception from any scenario as a hard
FAIL for that scenario, not a crash of the whole run.

Never call this module directly. It has no side effects on import beyond
defining functions.
#>

Set-StrictMode -Version Latest

$script:NoraMediServiceName = 'NoraMediBridge'
$script:NoraMediUpgradeCode = '{12BB6A03-A76B-40B2-828E-7DAF6FB4A61E}'
$script:ProgramFilesInstallDir = Join-Path ${env:ProgramFiles} 'NoraMedi\Bridge'
$script:ProgramDataRoot = Join-Path ${env:ProgramData} 'NoraMediBridge'
$script:ProgramDataConfigPath = Join-Path ${env:ProgramData} 'NoraMediBridge\config\appsettings.json'
$script:LegacyServiceConfigPath = Join-Path $script:ProgramFilesInstallDir 'Service\appsettings.json'

function Assert-Administrator {
    <# Refuses to continue unless the current process token is elevated (local Administrator). #>
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "This harness must run in an elevated (Administrator) PowerShell session. Re-launch PowerShell as Administrator and try again."
    }
}

function New-TestRunDirectory {
    param([Parameter(Mandatory)][string]$WorkingDirectory)

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $runDir = Join-Path $WorkingDirectory "run-$stamp"
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $runDir 'logs') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $runDir 'snapshots') -Force | Out-Null
    return $runDir
}

function Write-TestLog {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR', 'PASS', 'FAIL')][string]$Level = 'INFO',
        [string]$RunLogFile
    )
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'HH:mm:ss.fff'), $Level, $Message
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'FAIL'  { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'PASS'  { Write-Host $line -ForegroundColor Green }
        default { Write-Host $line }
    }
    if ($RunLogFile) {
        Add-Content -Path $RunLogFile -Value $line -Encoding utf8
    }
}

function Get-FileVersionDetails {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) {
        throw "Cannot read version info: '$Path' does not exist."
    }
    $info = (Get-Item -LiteralPath $Path).VersionInfo
    [pscustomobject]@{
        Path           = $Path
        FileVersion    = $info.FileVersion
        ProductVersion = $info.ProductVersion
    }
}

function Get-NoraMediServiceState {
    $svc = Get-Service -Name $script:NoraMediServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        return [pscustomobject]@{ Exists = $false; Status = $null; StartType = $null }
    }
    [pscustomobject]@{
        Exists    = $true
        Status    = $svc.Status.ToString()
        StartType = $svc.StartType.ToString()
    }
}

function Get-InstalledNoraMediProduct {
    <#
    Returns the installed MSI ProductCode + DisplayVersion for NoraMedi Bridge
    by reading the Uninstall registry key, or $null if not installed. Reading
    the registry (rather than msiexec /qb enumeration) avoids launching any
    UI and works identically for an interactively- or Burn-installed product.
    #>
    $roots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($root in $roots) {
        $match = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -eq 'NoraMedi Bridge' }
        if ($match) {
            return [pscustomobject]@{
                ProductCode    = $match.PSChildName
                DisplayVersion = $match.DisplayVersion
            }
        }
    }
    return $null
}

function Invoke-MsiProcess {
    <#
    Runs msiexec (or the Burn bundle EXE) with verbose logging, waits for
    completion, and returns exit code + log path. Never throws on a non-zero
    exit code - callers decide whether that's expected (e.g. Scenario D).
    #>
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$ArgumentList,
        [Parameter(Mandatory)][string]$LogDirectory,
        [Parameter(Mandatory)][string]$LogName
    )
    $msiLog = Join-Path $LogDirectory "$LogName.msi.log"
    $fullArgs = $ArgumentList + @('/l*v', "`"$msiLog`"")
    Write-TestLog "Running: $FilePath $($fullArgs -join ' ')" -Level INFO
    $proc = Start-Process -FilePath $FilePath -ArgumentList $fullArgs -Wait -PassThru -WindowStyle Hidden
    [pscustomobject]@{
        ExitCode = $proc.ExitCode
        LogPath  = $msiLog
    }
}

function Test-MsiLogContainsAction {
    param(
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][string]$ActionName,
        [switch]$ExpectSkipped
    )
    if (-not (Test-Path $LogPath)) {
        throw "MSI log not found at '$LogPath'."
    }
    $content = Get-Content -Path $LogPath -Raw -Encoding UTF8
    $skippedPattern = "Skipping action:\s+$([regex]::Escape($ActionName))"
    $ranPattern = "Doing action:\s+$([regex]::Escape($ActionName))"
    $wasSkipped = $content -match $skippedPattern
    $wasRun = $content -match $ranPattern
    if ($ExpectSkipped) {
        return ($wasSkipped -and -not $wasRun)
    }
    return ($wasRun -and -not $wasSkipped)
}

function Backup-NoraMediConfigState {
    <# Snapshots both appsettings.json locations (if present) into $Destination so a scenario can restore exact prior content. #>
    param([Parameter(Mandatory)][string]$Destination)
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    foreach ($pair in @(
            @{ Src = $script:LegacyServiceConfigPath; Name = 'legacy-appsettings.json' },
            @{ Src = $script:ProgramDataConfigPath; Name = 'programdata-appsettings.json' }
        )) {
        if (Test-Path $pair.Src) {
            Copy-Item -LiteralPath $pair.Src -Destination (Join-Path $Destination $pair.Name) -Force
        }
    }
}

function Confirm-DestructiveStep {
    <#
    Prompts for an explicit 'yes' before a destructive step, unless -Force
    is passed. Kept in this module (rather than the orchestrator script) so
    Reset-ScenarioState/Install-CandidateIfNeeded can call it directly and
    so it can be unit-tested / mocked in isolation from a real msiexec run.
    #>
    param(
        [Parameter(Mandatory)][string]$Message,
        [switch]$Force
    )
    if ($Force) { return }
    Write-Host ""
    Write-Host "ABOUT TO RUN A DESTRUCTIVE STEP:" -ForegroundColor Yellow
    Write-Host "  $Message" -ForegroundColor Yellow
    $answer = Read-Host "Type 'yes' to proceed, anything else to abort this run"
    if ($answer -ne 'yes') {
        throw "User did not confirm destructive step: $Message"
    }
}

function Uninstall-IfPresent {
    param([string]$LogDir, [string]$LogName)
    $installed = Get-InstalledNoraMediProduct
    if (-not $installed) { return }
    Write-TestLog "Removing installed NoraMedi Bridge ($($installed.DisplayVersion), $($installed.ProductCode)) before scenario." -Level WARN
    $result = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/x', $installed.ProductCode, '/quiet', '/norestart') -LogDirectory $LogDir -LogName $LogName
    if ($result.ExitCode -ne 0) {
        throw "Pre-scenario cleanup uninstall failed with exit code $($result.ExitCode). See $($result.LogPath)."
    }
    Start-Sleep -Seconds 2
}

function Reset-ScenarioState {
    <#
    Makes a scenario independently reproducible regardless of what an
    earlier scenario in the same run left behind: uninstalls whatever
    product is currently installed (any version) and, when -RemoveProgramData
    is passed, also deletes %ProgramData%\NoraMediBridge (and only that
    path - never any unrelated ProgramData tree). Scenarios B and D need
    "no ProgramData override exists yet" to be a guaranteed precondition,
    not an assumption; this replaces the old behavior of throwing when a
    prior scenario (e.g. C's sentinel override, or a previous B/E run) left
    one behind.
    #>
    param(
        [Parameter(Mandatory)][string]$ScenarioName,
        [Parameter(Mandatory)][string]$RunDir,
        [Parameter(Mandatory)][string]$LogNamePrefix,
        [switch]$RemoveProgramData,
        [switch]$Force
    )
    $installed = Get-InstalledNoraMediProduct
    $needsProgramDataRemoval = [bool]($RemoveProgramData -and (Test-Path $script:ProgramDataRoot))
    if (-not $installed -and -not $needsProgramDataRemoval) {
        Write-TestLog "${ScenarioName} reset: machine already clean (no product installed$(if ($RemoveProgramData) { ', no ProgramData override' }))." -Level INFO
        return
    }
    $planParts = New-Object System.Collections.Generic.List[string]
    if ($installed) { $planParts.Add("uninstall the currently installed product ($($installed.DisplayVersion))") }
    if ($needsProgramDataRemoval) { $planParts.Add("delete '$script:ProgramDataRoot'") }
    Confirm-DestructiveStep -Force:$Force -Message "${ScenarioName} reset will $($planParts -join ' and ') so this scenario starts from a known, independent state."
    Uninstall-IfPresent -LogDir $RunDir -LogName "$LogNamePrefix-reset-uninstall"
    if ($RemoveProgramData) {
        Remove-NoraMediProgramDataTree
    }
}

function Install-CandidateIfNeeded {
    <#
    Used by scenarios (C, E) that only need "the candidate is installed",
    not a from-scratch clean machine: if nothing is installed, installs the
    candidate; if a different version is installed (leftover from a B/D/A
    run earlier in the same invocation), resets first so the scenario still
    runs against the candidate version it's meant to test, never silently
    against whatever was left behind.
    #>
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$ScenarioName,
        [Parameter(Mandatory)][string]$RunDir,
        [Parameter(Mandatory)][string]$LogNamePrefix,
        [Parameter(Mandatory)][string]$CandidateMsiPath,
        [Parameter(Mandatory)][string]$CandidateVersion,
        [switch]$Force
    )
    $installed = Get-InstalledNoraMediProduct
    if ($installed -and $installed.DisplayVersion -eq $CandidateVersion) {
        Write-TestLog "${ScenarioName}: candidate $CandidateVersion already installed, reusing it." -Level INFO
        return
    }
    if ($installed) {
        Write-TestLog "${ScenarioName}: a different version ($($installed.DisplayVersion)) is installed; resetting to the candidate." -Level WARN
        Reset-ScenarioState -ScenarioName $ScenarioName -RunDir $RunDir -LogNamePrefix $LogNamePrefix -Force:$Force
    }
    Confirm-DestructiveStep -Force:$Force -Message "$ScenarioName requires the candidate ($CandidateVersion) installed; installing it now."
    $install = Invoke-MsiProcess -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$CandidateMsiPath`"", '/quiet', '/norestart') -LogDirectory $RunDir -LogName "$LogNamePrefix-install"
    Add-ScenarioAssertion -Result $Result -Name "Install for $ScenarioName exit code 0" -Condition ($install.ExitCode -eq 0) -Detail "exit=$($install.ExitCode)"
}

function Remove-NoraMediProgramDataTree {
    <#
    Deletes exactly %ProgramData%\NoraMediBridge (never anything else) so a
    scenario can start from a known "no override exists" state instead of
    throwing when a prior scenario left one behind. Caller is responsible
    for confirming this destructive step first (see Confirm-DestructiveStep
    in the orchestrator) - this function performs the removal unconditionally
    once called.
    #>
    if (Test-Path $script:ProgramDataRoot) {
        Remove-Item -LiteralPath $script:ProgramDataRoot -Recurse -Force
        Write-TestLog "Removed '$script:ProgramDataRoot' to reset to a known clean state." -Level WARN
    }
}

function Get-JsonConfigValue {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Section,
        [Parameter(Mandatory)][string]$Key
    )
    if (-not (Test-Path $Path)) { return $null }
    $json = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $sectionObj = $json.$Section
    if (-not $sectionObj) { return $null }
    return $sectionObj.$Key
}

function New-ScenarioResult {
    param([Parameter(Mandatory)][string]$Name)
    [pscustomobject]@{
        Scenario   = $Name
        Status     = 'Running'
        StartedAt  = (Get-Date).ToString('o')
        FinishedAt = $null
        Assertions = New-Object System.Collections.Generic.List[object]
        Notes      = New-Object System.Collections.Generic.List[string]
        LogDir     = $null
    }
}

function Add-ScenarioAssertion {
    <#
    Records a hard assertion. Throws immediately on failure (caught by the
    orchestrator's per-scenario try/catch) so a failed acceptance criterion
    always stops that scenario rather than continuing on bad state.
    #>
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][bool]$Condition,
        [string]$Detail = ''
    )
    $Result.Assertions.Add([pscustomobject]@{ Name = $Name; Passed = $Condition; Detail = $Detail })
    if ($Condition) {
        Write-TestLog "PASS: $Name $Detail" -Level PASS
    }
    else {
        Write-TestLog "FAIL: $Name $Detail" -Level FAIL
        throw "Assertion failed: $Name. $Detail"
    }
}

function Complete-ScenarioResult {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][ValidateSet('Pass', 'Fail', 'Skipped')][string]$Status
    )
    $Result.Status = $Status
    $Result.FinishedAt = (Get-Date).ToString('o')
    return $Result
}

Export-ModuleMember -Function * -Variable NoraMediServiceName, NoraMediUpgradeCode, ProgramFilesInstallDir, ProgramDataRoot, ProgramDataConfigPath, LegacyServiceConfigPath
