#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the NoraMedi Imaging Bridge Agent as a Windows service via NSSM.

.DESCRIPTION
  Creates the ProgramData directory tree, writes the bridge token to a
  dedicated ACL-locked file (never as a command-line argument, never
  echoed to the console or written to any log), registers the service
  with NSSM, and configures automatic restart.

  NSSM is NOT bundled with this repository. Download it from
  https://nssm.cc/download and either place nssm.exe on PATH or pass
  -NssmPath explicitly.

.PARAMETER ServiceAccount
  Optional dedicated Windows account (DOMAIN\user) to run the service as.
  If omitted, the service runs as LocalSystem (default pilot setup).
  LocalSystem has no access to network shares — if your imaging software
  exports to a UNC path, you MUST supply a -ServiceAccount that has read
  access to that share.

.PARAMETER NssmPath
  Path to nssm.exe if it is not already on PATH.

.EXAMPLE
  .\install-service.ps1
  .\install-service.ps1 -ServiceAccount "CLINIC\svc-noramedi" -NssmPath "C:\Tools\nssm.exe"
#>
param(
  [string]$ServiceAccount,
  [string]$NssmPath = "nssm.exe",
  [string]$InstallDir = "C:\ProgramData\NoraMediBridge",
  [string]$AgentDir = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

function Assert-NodeVersion {
  try {
    $nodeVersion = (node --version) -replace '^v', ''
    $major = [int]($nodeVersion -split '\.')[0]
    if ($major -lt 20) {
      throw "Node.js 20+ is required on this PC (found v$nodeVersion). This agent is not a standalone executable — install Node.js 20 LTS first."
    }
    Write-Host "Node.js v$nodeVersion detected — OK."
  } catch {
    throw "Node.js was not found on PATH. Install Node.js 20+ before running this script. $_"
  }
}

function Assert-Nssm {
  $resolved = Get-Command $NssmPath -ErrorAction SilentlyContinue
  if (-not $resolved) {
    throw "nssm.exe not found (looked for '$NssmPath'). Download it from https://nssm.cc/download and pass -NssmPath, or add it to PATH. This repository does not bundle NSSM."
  }
  return $resolved.Source
}

Write-Host "== NoraMedi Imaging Bridge Agent — Windows service installer ==" -ForegroundColor Cyan
Assert-NodeVersion
$nssmExe = Assert-Nssm

# 1. ProgramData directory tree
$dirs = @(
  $InstallDir,
  (Join-Path $InstallDir "queue\pending"),
  (Join-Path $InstallDir "queue\processing"),
  (Join-Path $InstallDir "queue\failed"),
  (Join-Path $InstallDir "logs"),
  (Join-Path $InstallDir "status")
)
foreach ($dir in $dirs) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}
Write-Host "Created directory tree under $InstallDir"

# 2. Config file (copy example on first install only — never overwrite an existing config)
$configPath = Join-Path $InstallDir "config.json"
if (-not (Test-Path $configPath)) {
  $examplePath = Join-Path $AgentDir "config\config.example.json"
  Copy-Item $examplePath $configPath
  Write-Host "Copied config.example.json to $configPath — EDIT IT before starting the service (watches[].deviceId, watches[].path)." -ForegroundColor Yellow
} else {
  Write-Host "Existing config.json found at $configPath — left untouched."
}

# 3. Token file — written directly to disk, never passed as an argument, never echoed, never logged.
$tokenFile = Join-Path $InstallDir "bridge-token.txt"
if (-not (Test-Path $tokenFile)) {
  Write-Host "No token file found. Paste the one-time bridge token issued by NoraMedi (input hidden):"
  $secureToken = Read-Host -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    $plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  Set-Content -Path $tokenFile -Value $plainToken -NoNewline
  Remove-Variable plainToken -ErrorAction SilentlyContinue
  Write-Host "Token written to $tokenFile"
} else {
  Write-Host "Existing token file found at $tokenFile — left untouched. Use replace-token.ps1 (see docs/48) to rotate it."
}

# 4. ACL: token file readable only by the account that will run the service, plus Administrators.
$serviceIdentity = if ($ServiceAccount) { $ServiceAccount } else { "SYSTEM" }
icacls $tokenFile /inheritance:r | Out-Null
icacls $tokenFile /grant:r "${serviceIdentity}:(R)" | Out-Null
icacls $tokenFile /grant:r "Administrators:(F)" | Out-Null
Write-Host "Token file ACL restricted to '$serviceIdentity' (read) and Administrators (full control)."

# 5. Register the service
$distEntry = Join-Path $AgentDir "dist\agent.cjs"
if (-not (Test-Path $distEntry)) {
  throw "dist\agent.cjs not found at $distEntry — run 'npm run build' before installing the service."
}

& $nssmExe install NoraMediBridge node "`"$distEntry`" --config `"$configPath`""
& $nssmExe set NoraMediBridge AppDirectory $AgentDir
& $nssmExe set NoraMediBridge AppRestartDelay 5000
& $nssmExe set NoraMediBridge Start SERVICE_AUTO_START
& $nssmExe set NoraMediBridge DisplayName "NoraMedi Imaging Bridge Agent"

if ($ServiceAccount) {
  Write-Host "Configuring service to run as $ServiceAccount (you will be prompted for its password by nssm)."
  Write-Host "Required permissions for '$ServiceAccount': READ access to every folder listed in config.watches[].path (including any network share), and READ/WRITE access to $InstallDir." -ForegroundColor Yellow
  & $nssmExe set NoraMediBridge ObjectName $ServiceAccount
} else {
  Write-Host "Running as LocalSystem (default). LocalSystem cannot read network shares — if your export folder is a UNC path, re-run with -ServiceAccount." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Installed. Edit $configPath (deviceId/path per watch) then run .\start-service.ps1" -ForegroundColor Green
