<#
.SYNOPSIS
  Requeues one or all items from queue/failed back to queue/pending.

.PARAMETER IngestKey
  A specific ingestKey to retry, or "all" to retry everything in failed/.
#>
param(
  [Parameter(Mandatory = $true)][string]$IngestKey,
  [string]$InstallDir = "C:\ProgramData\NoraMediBridge",
  [string]$AgentDir = (Split-Path -Parent $PSScriptRoot)
)
node (Join-Path $AgentDir "dist\agent.cjs") --config (Join-Path $InstallDir "config.json") --retry-failed $IngestKey
