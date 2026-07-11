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

Export-ModuleMember -Function * -Variable NoraMediServiceName, NoraMediUpgradeCode, ProgramFilesInstallDir, ProgramDataConfigPath, LegacyServiceConfigPath
