# F1-003-P2 — Stale disposable-runtime resource sweeper (Windows/PowerShell).
#
# Defense-in-depth only, not the primary cleanup mechanism (the orchestrator's
# own per-run teardown is). Removes ONLY Docker resources labeled
# com.noramedi.test-runtime=true and older than the configured TTL. Never
# performs a broad docker system prune; never touches unlabeled resources.
#
# Usage:
#   pwsh -File scripts/test-runtime/sweep.ps1                 # dry run (default)
#   pwsh -File scripts/test-runtime/sweep.ps1 -Live
#   pwsh -File scripts/test-runtime/sweep.ps1 -Live -TtlHours 8

param(
    [switch]$Live,
    [int]$TtlHours
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RepoRoot

$orchestratorArgs = @('cleanup-stale')
if ($Live) { $orchestratorArgs += '--live' }
if ($TtlHours) { $orchestratorArgs += "--ttl-hours=$TtlHours" }

& npx tsx scripts/test-runtime/orchestrator.ts @orchestratorArgs
exit $LASTEXITCODE
