# NoraMedi Windows Bridge — Secure Auto-Update (PR 6/7)

Replaces the truthful "not supported" placeholder (`CheckForUpdatesResponse.NotSupported()`,
PR 2/3) with a real, security-reviewed update path for a LocalSystem service.

## Threat model

The Service runs as **LocalSystem** — the update path is the highest-privilege
code path in the whole product. The threat we design against is: a
compromised/spoofed network position, a compromised onboarding/update HTTP
endpoint response, a malicious local (non-admin) process on the clinic PC, or
a tampered download must **never** result in arbitrary code execution as
LocalSystem. Concretely:

| Actor | Capability we must deny |
|---|---|
| Network attacker (MITM without a trusted cert) | Cannot serve a fake release descriptor over HTTPS; cannot tamper with a downloaded installer without SHA-256 detecting it |
| Compromised/malicious NoraMedi server response | Cannot point the bridge at a URL and hash that pass verification but aren't signed by NoraMedi's pinned publisher |
| Non-admin local process talking to the pipe | Cannot request installation of an arbitrary local file, URL, or command line — can only ask "check" / read status; `InstallUpdate` is admin-gated exactly like other privileged mutations (`PipeOperationPolicy`) |
| A user who is a local Administrator but not NoraMedi | Can trigger installing the **server-offered, already-verified** release; cannot supply their own URL/hash/args over IPC — those fields don't exist in the IPC request DTOs |
| Anyone with filesystem access to `%ProgramData%\NoraMediBridge\updates` | Blocked by the same LocalSystem+Administrators ACL as the rest of ProgramData (`ProgramDataAcl.ProtectDirectory`) |

## Release descriptor — one canonical source

`server/src/services/imaging/releaseMetadataValidation.ts` holds the only
version/SHA-256/URL parsers in the codebase. Both
`bridgeOnboardingConfig.ts` (PR 5, unauthenticated installer-download card)
and the new `bridgeUpdateConfig.ts` (PR 6, authenticated bridge update
descriptor) import from it — no second regex-based parser exists anywhere
else.

`bridgeUpdateConfig.ts` adds update-specific fields the onboarding card never
needed: `mode`, `signerThumbprint` (mandatory for production installability),
`minimumSourceVersion`, `notes`. See `docs/update-server.md` for the full env
var list and `GET /api/public/imaging/bridge/update` contract.

## Update modes (fail closed)

`IMAGING_BRIDGE_UPDATE_MODE` ∈ `disabled` (default) | `notify` | `automatic`.
Missing/unset/unrecognized ⇒ `disabled`. A fresh production deployment with
accidentally-present release metadata but no explicit mode never downloads or
installs anything — `disabled` only ever answers `{ mode: "disabled" }`,
`notify` surfaces "update available" to the Manager but never auto-installs,
`automatic` additionally allows the background loop to install without user
action (still gated by the queue-drain-safety window, §Background loop).

## Trust model — Authenticode + two-layer publisher pinning

No code-signing certificate exists in this repository at any point in its
history (confirmed: `docs/installer.md` "Code signing (not done in this
PR)"). This PR does **not** fabricate one. It implements the verification
side — `AuthenticodeVerifier` (WinVerifyTrust via
`System.Security.Cryptography.X509Certificates` + a `wintrust.dll` P/Invoke
wrapper, see `Updates/Trust/AuthenticodeVerifier.cs`) validates:

1. The file has a valid, non-tampered Authenticode signature
   (`WinVerifyTrust` with `WINTRUST_ACTION_GENERIC_VERIFY_V2` — chain builds
   and is trusted by this machine, code-signing EKU enforced by that action).
2. The signer's certificate **thumbprint** matches
   `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` (the release descriptor's
   declared signer) byte-for-byte (case-insensitive, hex-normalized — never
   a substring/"contains" check).

**A prior revision of this design stopped there.** An explicit threat-model
review of PR #149 found that check #2 alone means the trust anchor is
entirely "whatever the server's release descriptor says" — a compromised
backend, a compromised `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT`
deployment value, a stolen bridge bearer credential, or DNS/TLS control over
the update endpoint could all cause the bridge to accept a release "signed"
by any Authenticode certificate the attacker controls (even one that
chain-validates cleanly), because nothing on the bridge side constrained
which signer identity the server was allowed to declare.

**Fix: a third, independent check.** `Trust/PinnedPublisherThumbprints.cs`
is a bridge-local, compiled-in allowlist of accepted signer thumbprints —
never read from the server, ProgramData, the registry, or any runtime
config. Both `UpdateManager.StageAsync` (download-time verification) and
`UpdateHelperRunner.RunAsync` (the LocalSystem install-time re-verification,
independently) now require the signer thumbprint to be in this local
allowlist *in addition to* matching the server's declared thumbprint. The
server can narrow the accepted signer for one release; it can never expand
the set of signers this bridge will ever trust. `UpdateErrorCategory.UntrustedPublisher`
is the resulting fail-closed state when a release passes Authenticode and
matches its own declared thumbprint but that thumbprint isn't pinned locally.

`PinnedPublisherThumbprints.Values` is **empty** until NoraMedi's production
code-signing certificate is provisioned (PR 7 scope, see "What PR 7 still
owns" below). While empty, every production release is rejected as
`UntrustedPublisher` — this is the correct default for a LocalSystem-
privileged updater: the check exists and fails closed today, rather than
silently trusting the server, so PR 7 only has to populate two thumbprint
constants rather than design a trust mechanism from scratch.

Production installation (`RequireTrustedSignature=true`, the default) refuses
an unsigned installer, one signed by a thumbprint other than the one the
server declared, or one whose (matching) thumbprint isn't in the local
allowlist. For **local test-signing only** (this PR's own physical
acceptance run), the pinned thumbprint is a value the test harness itself
generates, trusts via `Updates:RequireTrustedSignature=false`, and passes as
`pinnedThumbprintOverride`/`trustVerifierOverride` test seams — never
shipped, never the production default, and the ephemeral cert/key are
deleted after the test run (§ physical acceptance).

**Key rotation:** add the new thumbprint to `PinnedPublisherThumbprints.Values`
*before* publishing it via `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` —
both entries ("current" + "next") stay accepted simultaneously during the
overlap window, so a bridge that hasn't yet updated past the cutover release
still accepts releases signed by either cert. The compiled-in list is
updated via a normal source-controlled code change and ships in the next
Core binary — an explicit, reviewable engineering change, not an
operational-only env var flip (which is exactly the property that closes
the server-can't-redefine-the-trust-root gap above). Documented further in
`docs/update-runbook.md`.

**No separate signed release-manifest is added.** Authenticode signing of
the installer executable itself, the bridge's own compiled-in publisher
allowlist, combined with SHA-256 pinning of that exact file by the
authenticated HTTPS release descriptor, is the trust boundary — a second
signed-manifest layer with an offline-pinned public key would duplicate the
same guarantee Authenticode + the local allowlist already provide, without
closing an additional gap, so it was scoped out rather than built
speculatively.

## Persistent update state machine

`%ProgramData%\NoraMediBridge\updates\state.json`, written atomically
(temp file + `File.Move(overwrite: true)`, same pattern as
`DpapiCredentialStore.Save`), protected by the existing ProgramData ACL.

```
Idle → Checking → (UpdateAvailable | UpToDate | CheckFailed)
UpdateAvailable → Downloading → (Verifying → Verified | DownloadFailed | VerificationFailed)
Verified → InstallLaunched → (Succeeded | InstallFailed | RebootRequired)
any state → Interrupted (on service start, if the previous state was not terminal)
```

A malformed/corrupt `state.json` deserializes to `Idle` (fail safe, never
crashes the service — mirrors `DpapiCredentialStore.TryRead`'s
"corrupted ⇒ treated as absent" pattern). A single in-memory gate
(`SemaphoreSlim(1,1)`, same shape as `BridgeOrchestrator._drainGate`) plus
the persisted state's non-idle-ness together prevent overlapping
check/download/install — a second `InstallUpdate` request while one is
in flight returns `AlreadyInProgress`, never a second installer launch.

## Download & staging

`Updates/UpdateDownloader.cs`: HTTPS-only in production (plain HTTP accepted
only for `localhost`/`127.0.0.1` outside `NODE_ENV=production`-equivalent —
mirrors `bridgeOnboardingConfig.isAcceptableDownloadUrl`'s existing rule,
reused verbatim via the shared server-side validator's parity contract).
Downloads to `updates\staging\<guid>.download` under a `CancellationToken`
with a bounded timeout and a hard byte-count cap
(`Updates:MaxDownloadBytes`, default 300 MB — installers are tens of MB;
300 MB gives headroom without accepting an unbounded stream). SHA-256 is
computed while streaming to disk (no separate re-read pass). Only after hash
match **and** signature/publisher verification does the file get
`File.Move`d (atomic on the same volume) to
`updates\NoraMediBridgeSetup-<version>.exe`; a mismatch or verification
failure deletes the partial/rejected file immediately. Never executed
in-place from the `.download` name.

## IPC contract changes

`PipeOperation` gains `GetUpdateStatus` (read-only, same tier as
`GetServiceStatus`/`CheckForUpdates`) and `InstallUpdate` (privileged,
added to `PipeOperationPolicy.PrivilegedOperations` — requires the calling
identity to be a local Administrator, exactly like
`ProvisionWithPairingCode`). `CheckForUpdates` keeps its name but now
performs a real check instead of returning `NotSupported()` unconditionally;
it still answers even while `BridgeSelfService:Enabled=false` (existing
`AllowedWhenFeatureDisabled` entry), always yielding a typed "update
subsystem disabled" state rather than attempting network I/O.

`InstallUpdate` takes **no parameters** — it only means "install the
already-verified, already-staged release the last successful check
produced." There is no URL/path/argument field on the request DTO, so no
amount of malformed/malicious IPC input can smuggle an arbitrary install
target — this is enforced structurally (empty request record), the same
technique already used for `ProvisionWithPairingCodeRequest` never carrying
a credential field.

## Self-update handoff — narrow helper process

The Service cannot reliably replace its own running EXE/DLLs. A new,
minimal console project, **NoraMedi.Bridge.UpdateHelper**, is launched
by the Service (`Process.Start`, LocalSystem-inherited token — same
privilege level, not elevated further) with a single argument: the path to
an **immutable JSON instruction file** the Service itself just wrote under
`updates\` (not command-line text, so nothing sensitive appears in the
process list; the instruction file itself contains no secrets — just a
staged file path, its expected SHA-256, and expected post-install
`ProductVersion`).

The helper:
1. Re-reads and re-verifies the staged file's SHA-256 and Authenticode
   publisher thumbprint itself — it does not trust the Service's prior
   verification blindly (defense in depth: if the Service process were
   somehow compromised after verifying but before launching the helper, the
   helper is the last gate before `msiexec` runs). The re-verified thumbprint
   is checked against the same bridge-local `PinnedPublisherThumbprints`
   allowlist the Service used, independently — not against anything the
   instruction file itself asserts about what's "trusted".
2. Runs `NoraMediBridgeSetup.exe /quiet /norestart` via
   `ProcessStartInfo.ArgumentList` (never a shell/cmd string) — the exact
   flags `docs/installer.md` documents as the supported silent-upgrade
   invocation.
3. Waits (bounded, default 180s) for the process to exit, capturing the exit
   code.
4. Polls `SCM` for `NoraMediBridge` to reach `Running` (bounded wait), then
   independently confirms the *installed* product version (read from the
   service binary's own `FileVersionInfo`, not anything the installer's exit
   code claims) matches `ExpectedVersion` — only then does it write
   `Succeeded`. A version mismatch writes `InstallFailed` with
   `PostInstallVersionMismatch` rather than a false `Succeeded`. An SCM
   timeout writes `InstallFailed` with a retryable=false category (needs
   support triage, not an automatic retry loop).
5. Recognizes MSI/Burn reboot-required exit codes (`ERROR_SUCCESS_REBOOT_REQUIRED`
   = 3010, and Burn's own reboot-pending signal) and writes `RebootRequired`
   truthfully instead of `Succeeded`.
6. Writes a small, redacted result log (`updates\helper-result-<ts>.log` —
   exit code, elapsed time, final SCM state; never a full command line with
   paths beyond the fixed install directory, never credentials) and exits.
   It does not stay resident.

The helper is intentionally **not** a generic command runner: its instruction
schema (`UpdateHelperInstruction`) has exactly five fields — staged file path
it independently re-validates, expected SHA-256, expected version,
`RequireTrustedSignature`, and the server-declared publisher thumbprint (also
independently re-checked against the bridge-local allowlist) — and it only
ever invokes one fixed executable name it itself resolves from the staging
directory. There is no field that lets a caller name an arbitrary program,
URL, or command line.

## Background checking loop

`Updates/UpdateBackgroundLoop.cs`, timer-driven like the existing
heartbeat/drain timers in `BridgeOrchestrator`, but on its own `Timer` so a
slow/failed update check can never delay heartbeat or queue draining:

- Configurable interval (`Updates:CheckIntervalMinutes`, default 240).
- Startup jitter (`Random.Shared.Next(0, JitterSeconds)`, default up to 600s)
  before the first check — avoids every clinic's bridge hitting the update
  endpoint in the same instant after a coordinated deploy.
- Bounded exponential backoff on repeated check failures (same
  `BackoffCalculator` already used for upload retries), capped, never
  unbounded retry-storming the server.
- `automatic` mode installs only when `_queue.Counts()` shows no
  `Processing` items (a safe drain checkpoint — never interrupts an
  in-flight upload) and only if no other check/download/install is already
  running (the state-machine gate above).
- Cancelled cleanly on service shutdown (`CancellationTokenSource` disposed
  in `BridgeOrchestrator.DisposeAsync`, same lifecycle as the drain/heartbeat
  timers).

## Manager UX

`UpdateViewModel` is rewritten from the placeholder to a real state machine
(see `docs/update-runbook.md` for the full state table and localized string
keys in `tr`/`en`/`fr`/`de`). No progress percentage is fabricated —
download/verify/install phases show an indeterminate spinner; only a
byte-count-based "X of Y MB" label is shown during download, sourced from
the real running total the downloader reports over IPC polling
(`GetUpdateStatus`), never a fake incrementing bar.

## PR 7/7 — production hardening (closed)

Everything listed below as "PR 7 still owns" as of PR 6 is now implemented
and tested — see `docs/update-runbook.md` for the full operational detail
on each:

- **Release/signing pipeline**: `windows-bridge/release/Build-Release.ps1`
  — deterministic, fail-closed, documented Burn detach/sign-engine/reattach/
  sign-bundle sequence, `/layout` container-integrity verification,
  hashes computed only from final signed bytes.
- **Publisher trust-pin rotation**: `Trust/PinnedPublisherThumbprints`
  already supported a current+next allowlist (designed in at PR 6 time);
  PR 7 adds the compiled-list sanity tests and the documented rotation
  sequence.
- **Staged rollout**: server-side `releaseId`/`channel`/`rolloutPercent`/
  `forced`, deterministic per-bridge cohort hashing, no bridge-side rollout
  logic at all.
- **One-step rollback**: `Updates/Rollback/*` (`RollbackCache`,
  `RollbackManager`, `RollbackStateStore`) plus
  `UpdateHelperRunner.RunRollbackAsync` — uninstall-then-install via the
  installer's `UpgradeCode`, single-flight, loop-prevented, triggered only
  by an internal crash-loop health check, never by IPC.
- **CI**: `.github/workflows/windows-bridge-pr.yml` (PR validation, unsigned
  structural build) and `windows-bridge-release.yml` (manual, protected,
  fails closed without a real signing identity).

**Still an external (non-code) gate**: no real NoraMedi production
Authenticode certificate has been provisioned. `Trust/PinnedPublisherThumbprints.Values`
ships empty and the protected release workflow refuses to run without
`NORAMEDI_SIGNING_THUMBPRINT`/`NORAMEDI_TIMESTAMP_URL` configured — this is
the correct fail-closed default, not an unresolved vulnerability. See
`docs/update-runbook.md` "Production certificate status" for the exact
remaining steps.

DICOM/TWAIN/vendor SDK adapters remain an unchanged scope exclusion from
`architecture.md`.
