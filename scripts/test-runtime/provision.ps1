# F1-003-P2 — Disposable PostgreSQL/MinIO test-runtime entry point (Windows/PowerShell).
#
# Thin wrapper only — all orchestration logic lives in orchestrator.ts (shared
# with the Bash entry point). Detects Docker Desktop availability, invokes the
# Node/TypeScript orchestrator via tsx, and forwards its real exit code.
#
# Usage (from repository root):
#   pwsh -File scripts/test-runtime/provision.ps1 -Profile postgres
#   pwsh -File scripts/test-runtime/provision.ps1 -Profile storage
#   pwsh -File scripts/test-runtime/provision.ps1 -Profile verify-parallel
#   pwsh -File scripts/test-runtime/provision.ps1 -Profile postgres -InjectFailure test

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('postgres', 'storage', 'verify-parallel')]
    [string]$Profile,

    [ValidateSet('test', 'migration', 'readiness', 'cleanup')]
    [string]$InjectFailure
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $RepoRoot

docker version --format '{{.Server.Version}}' *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not available (Docker Desktop engine unreachable). Start Docker Desktop and retry."
    exit 1
}

$orchestratorArgs = @($Profile)
if ($InjectFailure) {
    $orchestratorArgs += "--inject-failure=$InjectFailure"
}

# Best-effort Ctrl+C/engine-exit cleanup notice: the orchestrator itself
# installs SIGINT/SIGTERM handlers and attempts teardown; this event only
# documents the platform limitation (no guarantee survives a hard kill).
Register-EngineEvent PowerShell.Exiting -Action {
    Write-Host "[provision.ps1] Session exiting - the orchestrator installs its own signal handlers and attempts teardown; a hard process kill is NOT guaranteed to clean up (documented limitation)." -ForegroundColor Yellow
} | Out-Null

try {
    & npx tsx scripts/test-runtime/orchestrator.ts @orchestratorArgs
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 1
}
