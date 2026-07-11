# NoraMedi Bridge installer integration harness

`Invoke-InstallerIntegrationTests.ps1` drives real `msiexec` install / upgrade
/ repair / uninstall cycles against the built `NoraMediBridge.msi` and asserts
filesystem, registry, service, version, and config state. It exists to prove
the `MigrateLegacyConfig` legacy-config-preservation fix (see
`windows-bridge/installer/NoraMedi.Bridge.Installer/Package.wxs` and
`windows-bridge/docs/installer.md`, "Migrating a pre-0.4.5 install's local
config") actually behaves correctly on real Windows — the previous
AppSearch-gated version of that fix passed every MSI-table check yet never
ran on a real 0.4.4 -> 0.4.5 upgrade.

## This mutates the machine it runs on

It installs and removes a real Windows Service (`NoraMediBridge`), writes to
`%ProgramFiles%\NoraMedi\Bridge` and `%ProgramData%\NoraMediBridge`, and
touches `HKLM`. **Run it only on a disposable Windows test machine or a
dedicated physical bridge test box** — never against a machine holding
production clinic data. The script refuses to run at all if the current
PowerShell session is not elevated (Administrator).

Every destructive step (install/upgrade/uninstall/repair) prints what it's
about to do and asks for an explicit `yes` before proceeding, unless you pass
`-Force`. Scenario D (simulated failure/rollback) and the optional
`REMOVE_LOCAL_DATA=1` sub-case of Scenario E additionally require
`-RunDestructiveTests`; without it they are recorded as `Skipped`, not
silently passed.

## Prerequisites

- Elevated PowerShell 5.1+ session on the test machine.
- Both MSIs copied to the test machine (the previous shipped version and the
  candidate under test), plus their expected SHA-256 hashes. The script
  verifies both hashes before touching anything and refuses to run on a
  mismatch — this stops a stale or substituted artifact from being tested
  by accident.
- `InstallerTestHelpers.psm1` in the same directory as the orchestrator
  script (copy the whole `tests\installer` directory, not just the `.ps1`).

## Commands

All examples assume both files above; adjust paths/hashes to your artifacts.
`$sha1`/`$sha2` below are the SHA-256 hashes recorded for your build (the
same values reported at the end of the rebuild — see the top-level rebuild
report for the exact 0.4.6 MSI hash).

### Dry-run / preflight (no installs performed)

Verifies elevation, both MSI hashes, and takes a config snapshot without
installing, upgrading, or removing anything:

```powershell
.\Invoke-InstallerIntegrationTests.ps1 `
    -PreviousMsiPath 'C:\artifacts\0.4.5\NoraMediBridge.msi' -PreviousVersion '0.4.5' -PreviousMsiSha256 $sha1 `
    -CandidateMsiPath 'C:\artifacts\0.4.6\NoraMediBridge.msi' -CandidateVersion '0.4.6' -CandidateMsiSha256 $sha2 `
    -Scenario Preflight
```

### Run every non-destructive scenario (A, B, C, E)

```powershell
.\Invoke-InstallerIntegrationTests.ps1 `
    -PreviousMsiPath 'C:\artifacts\0.4.5\NoraMediBridge.msi' -PreviousVersion '0.4.5' -PreviousMsiSha256 $sha1 `
    -CandidateMsiPath 'C:\artifacts\0.4.6\NoraMediBridge.msi' -CandidateVersion '0.4.6' -CandidateMsiSha256 $sha2 `
    -Scenario A, B, C, E
```

### Run one scenario only (e.g. B, the legacy-layout upgrade)

```powershell
.\Invoke-InstallerIntegrationTests.ps1 `
    -PreviousMsiPath 'C:\artifacts\0.4.5\NoraMediBridge.msi' -PreviousVersion '0.4.5' -PreviousMsiSha256 $sha1 `
    -CandidateMsiPath 'C:\artifacts\0.4.6\NoraMediBridge.msi' -CandidateVersion '0.4.6' -CandidateMsiSha256 $sha2 `
    -Scenario B
```

### Full run including the destructive failure/rollback scenario

```powershell
.\Invoke-InstallerIntegrationTests.ps1 `
    -PreviousMsiPath 'C:\artifacts\0.4.5\NoraMediBridge.msi' -PreviousVersion '0.4.5' -PreviousMsiSha256 $sha1 `
    -CandidateMsiPath 'C:\artifacts\0.4.6\NoraMediBridge.msi' -CandidateVersion '0.4.6' -CandidateMsiSha256 $sha2 `
    -Scenario All -RunDestructiveTests
```

Each destructive step still prompts for confirmation; add `-Force` only once
you've read through the plan on a run you trust (e.g. re-running after a
fix, on a machine you've already reset).

### Collecting the result bundle

Every run creates `tests\installer\_runs\run-<timestamp>\` containing:

- `harness.log` — full timestamped log of everything the script did.
- `results.json` — machine-readable: one object per scenario with
  `Status` (`Pass`/`Fail`/`Skipped`), every named assertion (`Passed` +
  `Detail`), and free-text `Notes`.
- `results.txt` — the same information as a human-readable PASS/FAIL list.
- `<Scenario>-<step>.msi.log` — full verbose `msiexec /l*v` log for every
  individual install/upgrade/repair/uninstall the scenario ran (these are
  what `Test-MsiLogContainsAction` in the helpers module parses to confirm
  `MigrateLegacyConfig` did or didn't run).
- `snapshots\pre-run\` — a copy of both `appsettings.json` files (legacy
  Program Files and ProgramData override) as they stood before the run
  started, in case a scenario needs to be re-run against the same starting
  config.

Zip the whole `run-<timestamp>` directory and attach it to the report; it's
self-contained and has everything needed to audit what happened, without
ever containing credentials, pairing codes, or DPAPI material (only the
non-secret `BridgeSelfService` fields — `Enabled`/`ServerUrl`/`PipeName` —
are ever written to a log).

### Restoring the machine manually if interrupted

If the script is interrupted (Ctrl+C, terminal closed, machine rebooted)
mid-scenario, the machine may be left with NoraMedi Bridge installed, a
service in a non-default state, or (only during Scenario D) the
`%ProgramData%\NoraMediBridge\config` path occupied by a file instead of a
directory. To reset by hand:

```powershell
# 1. Remove whatever version is currently installed, if any.
$product = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object DisplayName -eq 'NoraMedi Bridge'
if ($product) { Start-Process msiexec.exe -ArgumentList '/x', $product.PSChildName, '/quiet', '/norestart' -Wait }

# 2. If Scenario D was interrupted, remove the artificial blocker file
#    (only if it's a FILE, not a directory - never delete the real config directory).
$blocker = "$env:ProgramData\NoraMediBridge\config"
if ((Test-Path $blocker) -and -not (Get-Item $blocker).PSIsContainer) {
    Remove-Item $blocker -Force
}

# 3. Program Files residue (should already be gone after step 1).
Remove-Item "$env:ProgramFiles\NoraMedi" -Recurse -Force -ErrorAction SilentlyContinue

# 4. ProgramData is intentionally NOT removed by normal uninstall (see
#    Package.wxs's RemoveLocalDataComponent comment) - this is expected
#    machine state, not something to "fix" unless you specifically want a
#    from-scratch clean-install test, in which case:
Remove-Item "$env:ProgramData\NoraMediBridge" -Recurse -Force -ErrorAction SilentlyContinue
```

## Scenario matrix

| Scenario | What it proves | Destructive? | Requires `-RunDestructiveTests` |
|---|---|---|---|
| A | Clean install: correct version, service registered/running, packaged defaults safe, `MigrateLegacyConfig` correctly skipped (no upgrade in progress) | Yes (install) | No |
| B | Legacy-layout upgrade: a pre-existing install's hand-edited `Enabled`/`ServerUrl`/`PipeName` survive the upgrade via the ProgramData override, `MigrateLegacyConfig` actually ran | Yes (install + upgrade) | No |
| C | Existing override is never clobbered by a repair | Yes (install/repair) | No |
| D | A forced migration failure aborts and rolls back the upgrade instead of continuing silently | Yes (install + forced-fail upgrade) | **Yes** |
| E | Repair preserves the override; normal uninstall removes Program Files/service but preserves ProgramData; optional `REMOVE_LOCAL_DATA=1` removes everything | Yes (repair + uninstall) | Only for the `REMOVE_LOCAL_DATA=1` sub-case |

## Expected runtime

Each `msiexec` install/upgrade/uninstall/repair cycle typically takes
10-60 seconds on typical test hardware. Scenarios A/C/D/E run one to two
cycles each; Scenario B runs two (install previous + upgrade). A full run of
all five scenarios, including confirmation prompts answered promptly,
should take well under 15 minutes.

## Expected machine side effects

- Installs and removes the `NoraMediBridge` Windows Service (LocalSystem).
- Writes/removes `%ProgramFiles%\NoraMedi\Bridge\...`.
- Creates `%ProgramData%\NoraMediBridge\config\appsettings.json` (this
  directory is intentionally never removed by a normal uninstall — see
  `RemoveLocalDataComponent` in `Package.wxs`).
- Writes `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\...`
  (standard MSI product registration) and
  `HKLM\SYSTEM\CurrentControlSet\Services\NoraMediBridge` (delayed-autostart
  registry value).
- Start Menu / optional Desktop shortcuts for NoraMedi Bridge Manager.

## Required elevation

Administrator (the script checks this itself via `Assert-Administrator` and
throws immediately if not elevated — no side effects happen before that
check).
