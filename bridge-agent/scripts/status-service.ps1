#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Shows the Windows service status plus the agent's own status.json.
#>
param(
  [string]$NssmPath = "nssm.exe",
  [string]$InstallDir = "C:\ProgramData\NoraMediBridge",
  [string]$AgentDir = (Split-Path -Parent $PSScriptRoot)
)
Write-Host "-- Windows service status --"
& $NssmPath status NoraMediBridge

Write-Host "`n-- Agent status.json --"
node (Join-Path $AgentDir "dist\agent.cjs") --config (Join-Path $InstallDir "config.json") --status
