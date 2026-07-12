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

## Every scenario is independently reproducible

Each scenario (`Reset-ScenarioState`/`Install-CandidateIfNeeded` in
`InstallerTestHelpers.psm1`) resets or ensures exactly the product/
ProgramData state it needs before it runs, rather than assuming a specific
prior scenario already put the machine in that state:

- **A** resets fully (uninstalls whatever is installed, deletes
  `%ProgramData%\NoraMediBridge`) before its clean install.
- **B** and **D** reset fully (same as A) before installing the previous
  version, so "no ProgramData override exists yet" is guaranteed, not
  assumed. A focused review found the original version of both simply
  `throw`s if an override already existed — meaning `-Scenario A,B,C,D,E`
  (or `All`) could fail because an earlier scenario in the *same run* left
  an override behind, not because of a real product defect.
- **C** and **E** reuse an already-installed candidate if present, or reset
  and install it if a different version (or nothing) is installed. C always
  seeds its own sentinel override, overwriting whatever was there; E seeds
  one itself if none exists yet.

This means every command below, and any scenario run alone (`-Scenario B`
with nothing pre-installed, `-Scenario D` right after a `-Scenario C` run,
etc.), works regardless of what a previous invocation left on the machine.
`StateMachine.Tests.ps1` (see below) proves this at the logic level.

## Prerequisites

- Elevated PowerShell 5.1+ session on the test machine.
- Both MSIs copied to the test machine (the previous shipped version and the
  candidate under test), plus their expected SHA-256 hashes. The script
  verifies both hashes before touching anything and refuses to run on a
  mismatch — this stops a stale or substituted artifact from being tested
  by accident.
- `InstallerTestHelpers.psm1` in the same directory as the orchestrator
  script (copy the whole `tests\installer` directory, not just the `.ps1`).

## Three local, non-mutating tests you can run first

All three are safe on any developer machine — no admin rights, no msiexec,
no service, no ProgramData/Program Files writes:

- `MigrateLegacyConfigCommand.Tests.ps1` extracts the *exact* authored
  `MigrateLegacyConfig` command from `Package.wxs` and runs it through a
  real `cmd.exe` against disposable temp directories (one path deliberately
  containing a space) to prove the command's own logic - source-missing,
  destination-exists (no clobber), destination-blocked (failure) - without
  needing an MSI at all.
- `StateMachine.Tests.ps1` proves the order-independence design described
  below (every scenario sequence, and each scenario run alone from a
  "poisoned" leftover state) using a pure in-memory model of the same
  reset/install rules `Reset-ScenarioState`/`Install-CandidateIfNeeded`
  implement — it does not import the module or touch a real product,
  specifically because an earlier attempt to mock the module's own
  functions in-place did not reliably override them and risked invoking a
  real `msiexec /x` against this machine's actual installed product.
- `InstallerTestHelpers.Tests.ps1` unit-tests `InstallerTestHelpers.psm1`
  directly under `Set-StrictMode -Version Latest`: safe optional-property
  handling in `Get-InstalledNoraMediProduct`/`Select-NoraMediProduct`
  (registry entries missing `DisplayName`/`PSChildName`/`DisplayVersion`,
  duplicate valid entries), the scalar-vs-array `.Count` bug on
  zero/one/multiple `Where-Object` results, and the fail-closed
  `Enable-HarnessMutation`/`Assert-HarnessMutationArmed` guard (importing
  the module fresh leaves it unarmed, so calling `Invoke-MsiProcess` or
  `Remove-NoraMediProgramDataTree` must throw before ever reaching a real
  `msiexec`/file deletion). A real Scenario B run once crashed immediately
  with `The property 'DisplayName' cannot be found on this object` and then
  `The property 'Count' cannot be found on this object` in the result
  summary — this file is the regression test for both.

Run any of them directly: `powershell -File .\MigrateLegacyConfigCommand.Tests.ps1`
/ `powershell -File .\StateMachine.Tests.ps1` /
`powershell -File .\InstallerTestHelpers.Tests.ps1`. All three exit 0 only if
every case passes.

## Machine mutation is armed explicitly, not assumed

`InstallerTestHelpers.psm1` refuses to run any mutating call — `msiexec`
(`Invoke-MsiProcess`), `Uninstall-IfPresent`, `Reset-ScenarioState`,
`Install-CandidateIfNeeded`, `Remove-NoraMediProgramDataTree` — until the
orchestrator calls `Enable-HarnessMutation`, which only happens after
elevation is confirmed, both MSI hashes verify, and at least one
non-Preflight scenario was actually requested. `-Scenario Preflight` never
arms mutation, so it is guaranteed read-only even if a future code path
accidentally tried to call one of those functions. This is a second,
independent layer of protection (fail closed at the function level) on top
of the existing interactive confirmation prompt — not a replacement for it —
added after an earlier module-function-mocking technique failed to reliably
override an already-imported function and came within one step of running a
real `msiexec /x` against a development machine's genuinely installed
product (see `StateMachine.Tests.ps1`'s header comment for the full
incident).

## Commands

All examples assume both files above; adjust paths/hashes to your artifacts.
`$sha1`/`$sha2` below are the SHA-256 hashes recorded for your build (the
same values reported at the end of the rebuild — see the top-level rebuild
report for the exact 0.4.6 MSI hash).

### Dry-run / preflight (no installs performed)

Verifies elevation and both MSI hashes, takes a config snapshot, and reports
current machine state — installed NoraMedi Bridge product/version (or none),
service existence/status, Program Files path existence, and ProgramData
override existence — without installing, upgrading, removing, starting, or
stopping anything. Machine mutation is never armed for a Preflight-only run
(see "Machine mutation is armed explicitly" below), so this is guaranteed
read-only regardless of what the rest of the script does:

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

### Recommended order on the physical test machine

Because every scenario now resets its own required state (see "Every
scenario is independently reproducible" above), each of the commands below
can be run as its own separate invocation — useful for reviewing one
scenario's log/result bundle at a time instead of one large combined run:

1. `-Scenario Preflight`
2. `-Scenario B` (alone)
3. `-Scenario A` (alone)
4. `-Scenario C` (alone)
5. `-Scenario E` (alone)
6. `-Scenario D -RunDestructiveTests` (last, since it's the one that forces
   a failure/rollback)

Running `-Scenario A,B,C,E` or `-Scenario All` in one invocation (as in the
examples above) is equally valid — order-independence means both styles are
supported, not just the one-scenario-at-a-time list.

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
