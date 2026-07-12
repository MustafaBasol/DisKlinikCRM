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

## Trust model — Authenticode + pinned publisher

No code-signing certificate exists in this repository at any point in its
history (confirmed: `docs/installer.md` "Code signing (not done in this
PR)"). This PR does **not** fabricate one. It implements the verification
side — `AuthenticodeTrustVerifier` (WinVerifyTrust via
`System.Security.Cryptography.X509Certificates` + `AuthenticodeSignatureInformation`
availability check) validates:

1. The file has a valid, non-tampered Authenticode signature
   (`SignerCertificate` chain builds, `TrustStatus == NoError`, exercised via
   `.NET`'s built-in `System.Management.Automation`-free
   `System.Security.Cryptography.Pkcs`/WinVerifyTrust P/Invoke wrapper —
   see `Updates/Trust/AuthenticodeVerifier.cs`).
2. The signer's certificate **thumbprint** matches
   `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` byte-for-byte (case
   insensitive, hex-normalized comparison — never a substring/"contains"
   check). This is a pinned identity, not "any signature Windows currently
   trusts" — a differently-issued cert for the same subject name is rejected.

Production installation (`RequireTrustedSignature=true`, the default) refuses
an unsigned installer or one signed by any thumbprint other than the pinned
one. For **local test-signing only** (this PR's own physical acceptance
run), the pinned thumbprint is a value the test harness itself generates and
trusts via `Updates:RequireTrustedSignature=false` + an explicit
`Updates:TestPublisherThumbprint` override — never shipped, never the
production default, and the ephemeral cert/key are deleted after the test
run (§ physical acceptance).

**Key rotation:** rotating the signing certificate means publishing the new
thumbprint via `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` *before* any
release is signed with the new key — a bridge polling the old thumbprint
value will fail-closed-reject a release signed by the new (not-yet-pinned)
cert, which is the safe direction to fail. There is no in-band key rotation
message; rotation is an out-of-band operational deploy of the env var,
documented in `docs/update-runbook.md`.

**No separate signed release-manifest is added.** Authenticode signing of
the installer executable itself, combined with SHA-256 pinning of that exact
file by the authenticated HTTPS release descriptor, is the trust boundary —
a second signed-manifest layer would duplicate the same guarantee (the
descriptor already comes over an authenticated HTTPS channel) without
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
   helper is the last gate before `msiexec` runs).
2. Runs `NoraMediBridgeSetup.exe /quiet /norestart` via
   `ProcessStartInfo.ArgumentList` (never a shell/cmd string) — the exact
   flags `docs/installer.md` documents as the supported silent-upgrade
   invocation.
3. Waits (bounded, default 180s) for the process to exit, capturing the exit
   code.
4. Polls `SCM` for `NoraMediBridge` to reach `Running` (bounded wait) — only
   then does it write `Succeeded` to the shared state file. A timeout writes
   `InstallFailed` with a retryable=false category (needs support triage,
   not an automatic retry loop).
5. Recognizes MSI/Burn reboot-required exit codes (`ERROR_SUCCESS_REBOOT_REQUIRED`
   = 3010, and Burn's own reboot-pending signal) and writes `RebootRequired`
   truthfully instead of `Succeeded`.
6. Writes a small, redacted result log (`updates\helper-result-<ts>.log` —
   exit code, elapsed time, final SCM state; never a full command line with
   paths beyond the fixed install directory, never credentials) and exits.
   It does not stay resident.

The helper is intentionally **not** a generic command runner: its instruction
schema has exactly three fields (staged file path it independently
re-validates, expected SHA-256, expected version) and it only ever invokes
one fixed executable name it itself resolves from the staging directory —
there is no field that lets a caller name an arbitrary program.

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

## What PR 7 still owns

- Production Authenticode signing credential acquisition/HSM integration —
  this PR builds and tests entirely against an ephemeral local test
  certificate; no production certificate exists yet.
- Any rollback/auto-revert of a failed installation — not implemented;
  `InstallFailed` is a truthful terminal state requiring manual
  reinstall/support, not an automatic downgrade.
- Staged rollout percentages/channels — the `mode`/`minimumSourceVersion`
  fields leave room for this but no rollout logic is implemented.
- DICOM/TWAIN/vendor SDK adapters, production E2E hardening — unchanged
  scope exclusions from `architecture.md`.
