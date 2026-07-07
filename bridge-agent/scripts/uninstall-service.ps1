#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Stops and removes the NoraMedi Imaging Bridge Agent Windows service.
  Does NOT delete C:\ProgramData\NoraMediBridge (config/queue/logs are preserved).
#>
param(
  [string]$NssmPath = "nssm.exe"
)
$ErrorActionPreference = "Stop"
& $NssmPath stop NoraMediBridge 2>$null
& $NssmPath remove NoraMediBridge confirm
Write-Host "Service removed. C:\ProgramData\NoraMediBridge was left in place — delete it manually if a full uninstall is required."
