# NoraMedi Windows Bridge — Installer

This is PR 4/7 of the self-service imaging bridge: a single Windows
installer, `NoraMediBridgeSetup.exe`, that packages the Service (PR 2) and
Manager (PR 3) into one deliverable a clinic can run without installing
.NET, Node.js, NSSM, or any PowerShell script.

## Toolchain

- **WiX Toolset v5.0.2** (pinned in `Directory.Packages.props`: `WixToolset.UI.wixext`,
  `WixToolset.Util.wixext`, `WixToolset.BootstrapperApplications.wixext`, all
  `5.0.2`), installed as a `dotnet tool` (`wix`) for ad-hoc use, but built
  normally via `dotnet build`/MSBuild through the `WixToolset.Sdk` project
  SDK — no separate `wix build` invocation is needed in CI.
- Two projects under `windows-bridge/installer/`:
  - **NoraMedi.Bridge.Installer** — the MSI (`NoraMediBridge.msi`). Not
    meant to be run directly by a clinic user.
  - **NoraMedi.Bridge.Bundle** — a Burn bootstrapper that chains the MSI
    into the single **`NoraMediBridgeSetup.exe`** deliverable. This is what
    requests UAC (once) and is what a clinic user actually runs.
- `windows-bridge/installer/Directory.Build.props` is an intentionally
  empty, non-importing file — it stops MSBuild's upward search before it
  reaches `../Directory.Build.props`, which sets C#-only properties
  (`TargetFramework net10.0-windows`, analyzers) that don't apply to WiX
  projects.

## Building locally

```powershell
# 1. Publish self-contained win-x64 outputs (no .NET runtime needed on the target machine)
dotnet publish windows-bridge\src\NoraMedi.Bridge.Service\NoraMedi.Bridge.Service.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o windows-bridge\publish\Service
dotnet publish windows-bridge\src\NoraMedi.Bridge.Manager\NoraMedi.Bridge.Manager.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o windows-bridge\publish\Manager

# 2. Build the MSI
dotnet build windows-bridge\installer\NoraMedi.Bridge.Installer -c Release `
  -p:PublishServiceDir="$PWD\windows-bridge\publish\Service" `
  -p:PublishManagerDir="$PWD\windows-bridge\publish\Manager" `
  -p:ProductVersion=0.4.0

# 3. Build the bundle (wraps the MSI from step 2)
dotnet build windows-bridge\installer\NoraMedi.Bridge.Bundle -c Release `
  -p:MsiSourceFile="$PWD\windows-bridge\installer\NoraMedi.Bridge.Installer\bin\x64\Release\NoraMediBridge.msi" `
  -p:ProductVersion=0.4.0

# Output: windows-bridge\installer\NoraMedi.Bridge.Bundle\bin\x64\Release\NoraMediBridgeSetup.exe
```

`ProductVersion` must be a 3-field MSI version (`Major.Minor.Build`, each
≤ 255) and must match between the MSI and Bundle builds for a given
release. `PublishServiceDir`/`PublishManagerDir` must point at the *outputs*
of step 1, not the project directories.

Both `.wixproj` files run a pre-build validation target
(`ValidateInstallerBuildInputs`/`ValidateBundleBuildInputs`) that fails the
build with a specific `MSBuild` error — naming exactly which property or
file is the problem — if `PublishServiceDir`/`PublishManagerDir`/
`MsiSourceFile` is missing, empty, doesn't exist, doesn't contain the
expected executable/MSI, or if `ProductVersion` is missing or not a valid
`Major.Minor.Build` version. This turns what used to be a silent
wrong-files-harvested or wrong-MSI-chained failure into an immediate,
readable build error.

## Layout on disk

| What | Where |
|---|---|
| Service binaries | `%ProgramFiles%\NoraMedi\Bridge\Service\` |
| Manager binaries | `%ProgramFiles%\NoraMedi\Bridge\Manager\` |
| Windows Service | `NoraMediBridge` (LocalSystem, automatic-delayed start) |
| Start Menu shortcut | `NoraMedi Bridge\NoraMedi Bridge Manager` (always installed) |
| Desktop shortcut | `NoraMedi Bridge Manager.lnk` (on by default; silent opt-out below; choice persists across repair/upgrade) |
| Runtime data (unmanaged by the installer) | `%ProgramData%\NoraMediBridge\` |

The install location is **fixed** at `%ProgramFiles%\NoraMedi\Bridge` — the
installer UI (`WixUI_Minimal`) has no directory-picker dialog. A LocalSystem
service must not be installable to an arbitrary, potentially
non-admin-writable path (privilege-escalation risk, flagged in Copilot
review of PR #146), so `INSTALLFOLDER` is never exposed as a settable UI or
command-line property.

Service and Manager are self-contained publishes that each carry their own
copy of the .NET runtime and `NoraMedi.Bridge.Core`, so many filenames (and,
for Manager, WPF's 13 satellite-resource culture folders) are byte-identical
across the two trees. They are installed into **separate subdirectories**
(`Service\`, `Manager\`) — mounting both trees at the same directory made
WiX's `<Files>` harvesting generate colliding File/Component identifiers.

### Why ProgramData is never touched by the installer

`%ProgramData%\NoraMediBridge` (DPAPI-protected credential, folder
bindings, the SQLite queue + spool, diagnostics/logs) is **not a WiX-owned
component** at all. The Service itself creates and ACLs that directory on
every start, regardless of the feature flag
(`BridgeOrchestrator` → `Security.ProgramDataAcl.ProtectDirectory`,
see `docs/security.md`). Because Windows Installer only ever removes what
it itself installed, this directory survives upgrade, repair, and a normal
uninstall automatically — there was nothing to author to make that true.

## Delayed automatic start

Windows Installer's `ServiceInstall` table has no native "delayed
auto-start" bit — only `auto`/`demand`/`disabled`. The installer sets
`StartType=auto` and separately writes the `DelayedAutostart=1` `REG_DWORD`
under `HKLM\SYSTEM\CurrentControlSet\Services\NoraMediBridge`, which is
exactly what `sc config NoraMediBridge start=delayed-auto` does under the
hood. (`sc qc` in some Windows builds doesn't print `(DELAYED)` even when
this is set correctly — verify with
`Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Services\NoraMediBridge -Name DelayedAutostart`.)

## Explicit opt-in full data removal

A normal uninstall — GUI, `NoraMediBridgeSetup.exe /uninstall /quiet`, or
`msiexec /x` — **never deletes `%ProgramData%\NoraMediBridge`.** An operator
decommissioning a machine who wants a fully clean removal opts in
explicitly:

```powershell
# Via the bundle (recommended — this is what a clinic support runbook should use)
NoraMediBridgeSetup.exe /uninstall /quiet REMOVE_LOCAL_DATA=1

# Equivalent, driving the MSI directly
msiexec /x NoraMediBridge.msi REMOVE_LOCAL_DATA=1 /quiet
```

This is a silent-install property today, not a GUI checkbox — the stock
`WixUI_Minimal` dialog set has no uninstall-time custom dialog without
substantially more UI authoring than this PR's scope justified. A future PR
can add a proper "Remove local data" checkbox to the maintenance/uninstall
flow; until then this is the documented, supported mechanism.

## Desktop shortcut choice persists across repair/upgrade

`INSTALLDESKTOPSHORTCUT` is resolved in this order, so a user's original
choice survives future maintenance without needing to be repeated:

1. **Command line**, if passed on that specific invocation (e.g.
   `INSTALLDESKTOPSHORTCUT=0` on a repair) — always wins.
2. **The previous session's choice**, read back via a `RegistrySearch` on
   `HKCU\Software\NoraMedi\Bridge\DesktopShortcutChoice`. That value is
   rewritten on every install/repair/upgrade by the (always-installed)
   Start Menu shortcut component, specifically so it is still readable even
   when the desktop shortcut itself was declined.
3. **`1` (on)**, only when neither of the above applies — i.e. a genuinely
   first-ever install.

Windows Installer's `AppSearch` action never overwrites a property that
already has a value, which is what makes step 1 take priority over step 2
without any extra authoring.

## Silent install / uninstall

```powershell
# Silent install (desktop shortcut on by default)
NoraMediBridgeSetup.exe /quiet /norestart

# Silent install, skip the desktop shortcut
NoraMediBridgeSetup.exe /quiet /norestart INSTALLDESKTOPSHORTCUT=0

# Silent uninstall (ProgramData preserved)
NoraMediBridgeSetup.exe /uninstall /quiet /norestart

# Silent uninstall + full local data wipe
NoraMediBridgeSetup.exe /uninstall /quiet /norestart REMOVE_LOCAL_DATA=1

# Repair (same as msiexec /fa against the chained MSI)
NoraMediBridgeSetup.exe /repair /quiet
```

Both `REMOVE_LOCAL_DATA` and `INSTALLDESKTOPSHORTCUT` are declared as
overridable Bundle variables in `Bundle.wxs` and forwarded to the MSI as
`MsiProperty` rows — a caller only needs to know the Bundle's command line,
never that an MSI is chained underneath.

## Upgrade behavior and the bug that shaped it

`MajorUpgrade` uses a stable `UpgradeCode`
(`12BB6A03-A76B-40B2-828E-7DAF6FB4A61E` for the MSI,
`7C3D8E1A-9A2A-4F5D-9C41-2F3E1B7C6D42` for the Bundle) so future versions
upgrade in place rather than installing side-by-side. `ProductCode` is left
to WiX's default per-build auto-generation, as recommended.

`MajorUpgrade`'s `Schedule` is deliberately **not** set (which defaults to
`afterInstallExecute`, the late option) — an early first attempt at
`afterInstallInitialize` was tested end to end on real hardware (install
0.4.0, upgrade to 0.4.1) and **left the Windows Service completely
unregistered** after the upgrade completed successfully. With
`RemoveExistingProducts` scheduled before the new product's
`InstallServices`, Windows Installer's component-sharing logic (the same
fixed Component GUID and Service Name are intentionally reused across
versions, which is what makes the upgrade an in-place reinstall rather than
a fresh one) computed `Action=Null` for `ServiceInstallComponent` in the new
product's install session, so `InstallServices` had nothing to process.
Scheduling late — remove the old product only after the new one is fully
installed and running — avoided the issue and was reverified end to end
(0.4.1 → 0.4.2).

A second real-hardware bug was found and fixed the same way: the
`REMOVE_LOCAL_DATA=1` property was initially read too late by
`util:RemoveFolderEx`'s underlying action (`Wix4RemoveFoldersEx_X64`, found
by querying the built MSI's `InstallExecuteSequence` table directly), which
turned out to be scheduled at sequence 799 — before `CostInitialize`, far
earlier than intuition suggests. The property-setting `<SetProperty>` now
runs `Before="Wix4RemoveFoldersEx_X64"` explicitly.

## Supported Windows versions

The installer's `Launch` condition requires **Windows 10 / Windows Server
2016 (`VersionNT >= 1000`) or later**, 64-bit only. An earlier version of
this condition (`VersionNT >= 603`) incorrectly permitted Windows 8.1 /
Server 2012 R2, which .NET 10 (the Service/Manager's target framework) does
not support; installing on Windows 8.1 now fails cleanly with a clear
message instead of installing binaries that cannot run.

## Security

- The install directory is fixed at `%ProgramFiles%\NoraMedi\Bridge` — there
  is no directory-picker UI, so a LocalSystem service binary can never end
  up in a custom, potentially non-admin-writable location.
- Program Files install location inherits the standard non-user-writable
  ACL (`BUILTIN\Users` get `RX` only) — verified with `icacls` on real
  hardware after install.
- `%ProgramData%\NoraMediBridge`'s ACL (LocalSystem + Administrators only,
  inheritance broken) is untouched by the installer and was reconfirmed
  intact after install/upgrade/uninstall.
- The Named Pipe ACL and IPC authorization from PR 2 are unaffected by this
  PR — the installer doesn't touch pipe permissions at all.
- `BridgeSelfService:Enabled` remains `false` by default
  (`appsettings.json`, unchanged by this PR) — installing the product does
  not turn on data upload.
- No secrets are embedded in the installer, its properties, or its logs.
  `REMOVE_LOCAL_DATA`/`INSTALLDESKTOPSHORTCUT` are the only custom
  properties, and neither carries sensitive data.
- Program Files binaries are self-contained publishes; nothing is
  downloaded during install, and there is no update-check or download
  behavior of any kind (`CheckForUpdates` in the Manager still returns a
  truthful "not supported," unchanged from PR 3).

## Code signing (not done in this PR)

`NoraMediBridgeSetup.exe`, `NoraMediBridge.msi`, and the two chained
executables are **unsigned** in this PR — there is no Authenticode
certificate or signing credential available yet, and none is fabricated.
Expect a SmartScreen/"Unknown publisher" UAC prompt on a clean machine; this
is expected, not a defect. When production signing credentials exist, sign:

1. `windows-bridge\publish\Service\NoraMediBridge.Service.exe` and
   `windows-bridge\publish\Manager\NoraMediBridge.Manager.exe` (`signtool
   sign`) **before** they're fed into the MSI build.
2. `NoraMediBridge.msi` after the MSI build.
3. `NoraMediBridgeSetup.exe` after the Bundle build (Burn bundles are
   signed as a normal PE, same as any other `.exe`).

All three need the same certificate/timestamp server; signing is out of
scope for this PR per the root spec.

## Scope exclusions (unchanged from the root spec)

Web onboarding UI (PR 5), a real auto-updater (PR 6), release download
infrastructure, and production feature enablement are all explicitly out of
scope here — see `architecture.md`. `BridgeSelfService:Enabled` remains
`false` in the shipped `appsettings.json`.
