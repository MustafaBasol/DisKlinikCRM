# NoraMedi Windows Bridge — Auto-Update Runbook (PR 6/7)

## State machine reference

Persisted at `%ProgramData%\NoraMediBridge\updates\state.json`, written
atomically (temp file + rename), ACL'd the same as the rest of ProgramData
(inherits from the already-protected root — see `UpdateStateStore`/
`UpdateDownloader` source comments).

```
Idle ──check──> Checking ──> UpToDate | UpdateAvailable | Unsupported | Disabled
UpdateAvailable ──(notify/automatic)──> Downloading ──> Verifying ──> Verified | DownloadFailed | VerificationFailed
Verified ──InstallUpdate (admin, IPC)──> InstallLaunched ──(helper)──> Succeeded | InstallFailed | RebootRequired
any non-terminal state, on Service restart ──> Interrupted (until the next real check or a late-arriving helper result corrects it)
```

`InstalledVersion` is **never** trusted from the persisted file — every
`Load()` call reconciles it against the live `AgentVersion.Current` of the
process doing the loading (see `UpdateStateStore.Load` — fixed during PR 6
physical acceptance after the persisted value was found to still say the
pre-update version immediately after a real successful self-update).

**Startup reconciliation (PR 7 — closed):** `BridgeOrchestrator.Start()` calls
`UpdateManager.ReconcileHelperResultOnStartup()` (which both reclassifies a
non-terminal state as `Interrupted` and re-reads any waiting
`helper-result-*.json`) synchronously, before `UpdateBackgroundLoop.Start()`
ever begins its jittered timer. A late-arriving helper result is therefore
always resolved to its true terminal state (`Succeeded`/`RebootRequired`/
`InstallFailed`) the moment the Service process starts — a freshly-restarted
Manager never has to wait out `StartupJitterSeconds` to see the real outcome.
Regression-tested (`UpdateStateStoreTests`, `UpdateBackgroundLoopTests`).

## Manager workflow

1. **Updates** tab shows installed/offered version and the current state
   label (see `docs/update-architecture.md` "Manager UX" for the full
   state → label table).
2. **Check for Updates** — always safe, always answered even while the
   feature flag is off system-wide, never requires elevation.
3. **Install Update** (only visible/enabled once `Verified`) — is a
   privileged IPC call; a standard (non-administrator) Windows user sees
   the existing "Action required — restart as Administrator" gate the app
   already uses for every other privileged action.
4. No fake progress bar anywhere — indeterminate spinner during
   check/download/verify/install, plus a real "X of Y MB" download counter
   sourced from the actual streamed byte count.

## Local test-signing procedure (used for PR 6 physical acceptance)

**Critical: a WiX Burn bundle (`NoraMediBridgeSetup.exe`) cannot be signed
by simply running `signtool sign`/`Set-AuthenticodeSignature` on the final
assembled file.** This was discovered the hard way during physical
acceptance: a naively-signed bundle installs fine as a first-time install
tool, but fails at runtime with `0x80070002` ("Failed to resolve source...
container: WixAttachedContainer") — Authenticode's appended certificate
blob shifts what Burn's own attached-container footer parser reads as
end-of-file, and the file is not actually installable at all, silently
(both `Get-AuthenticodeSignature` and `signtool verify` still happily
report the file as validly signed — only *running* it reveals the
corruption). Every real deployment (including production release signing)
must use WiX's own detach/reattach workflow instead:

```powershell
# 1. Build the bundle normally (unsigned) — see docs/installer.md.

# 2. Detach the bare engine from the assembled bundle.
wix burn detach NoraMediBridgeSetup.exe -engine engine.exe

# 3. Sign ONLY the detached engine.
signtool sign /sha1 <thumbprint> /fd SHA256 /tr <timestamp-url> /td SHA256 engine.exe

# 4. Reattach the signed engine — this recomputes the bundle's internal
#    container offsets relative to the now-larger signed engine, which is
#    what makes the attached containers findable again at runtime.
wix burn reattach NoraMediBridgeSetup.exe -engine engine.exe -out NoraMediBridgeSetup.exe

# 5. Sign the FINAL reattached bundle a second time — step 4 does not
#    itself produce a validly-signed outer file (Get-AuthenticodeSignature
#    on the reattach output reports NotSigned); this second signature is
#    what Explorer/SmartScreen/WinVerifyTrust/AuthenticodeVerifier actually
#    check.
signtool sign /sha1 <thumbprint> /fd SHA256 /tr <timestamp-url> /td SHA256 NoraMediBridgeSetup.exe
```

Skipping step 5, or signing the assembled bundle directly without steps
2–4, both produce a file that *reports* as validly signed but is not
actually functional — always physically run the signed bundle
(`/quiet /norestart` against a disposable VM/snapshot) as the final proof,
not just `Get-AuthenticodeSignature`.

For the ephemeral local test certificate itself:

```powershell
$cert = New-SelfSignedCertificate -Subject "CN=<test>" -Type CodeSigningCert `
  -KeyAlgorithm RSA -KeyLength 2048 -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddDays(2) -KeyExportPolicy Exportable

# Trust it as its own root (self-signed leaf) so WinVerifyTrust chain-builds it —
# test-only; a production cert chains to a real, already-trusted CA instead.
Export-PfxCertificate -Cert $cert -FilePath test.pfx -Password $pwd
Import-PfxCertificate -FilePath test.pfx -CertStoreLocation Cert:\LocalMachine\Root -Password $pwd
Import-PfxCertificate -FilePath test.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPublisher -Password $pwd
```

**After testing, always remove the ephemeral certificate from every store
it was imported into (`Cert:\LocalMachine\Root`,
`Cert:\LocalMachine\TrustedPublisher`, `Cert:\CurrentUser\My`) and delete
the exported `.pfx`.** Never commit a `.pfx`, private key, or password to
the repository.

## Production signing requirements

1. A real Authenticode code-signing certificate from a publicly trusted CA
   (not self-signed) — acquisition is out of scope for this PR (PR 7).
2. A timestamp server (`/tr .../td SHA256`) so signatures remain valid
   after the certificate itself expires.
3. Sign, in order: Service exe, Manager exe, UpdateHelper exe (all
   **before** the MSI build harvests them), then the MSI, then — via the
   detach/sign-engine/reattach/sign-bundle sequence above — the Bundle.
4. Publish the certificate's thumbprint via
   `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` (see `update-server.md`).

## Support/operator triage

| Manager shows | Likely cause | Action |
|---|---|---|
| "Update disabled" | Server-side `IMAGING_BRIDGE_UPDATE_MODE` is `disabled`, or metadata is incomplete/malformed | Check server env config; nothing wrong with the clinic's machine |
| "Download failed" | Network issue, or the release URL is unreachable from that clinic's network | Retry; check clinic's outbound HTTPS access |
| "Integrity verification failed" | SHA-256 mismatch — a corrupted download or a wrong hash published | **Do not** ask the clinic to retry blindly — verify the published hash matches the actual file before republishing |
| "Publisher verification failed" | Wrong/rotated certificate mismatch, or (rare) a MITM | Investigate before republishing; never lower `RequireTrustedSignature` to work around this |
| "Installer failed" | The silent install itself failed (see the bounded, redacted `helper-result-*.json` in `updates\`) | Escalate for manual installer troubleshooting; automatic retry is not implemented (no rollback — see `update-architecture.md` "PR 7") |
| "Reboot required" | Installer returned `3010` | Ask the clinic to reboot; the update itself already succeeded |
| "Previous update attempt was interrupted" that doesn't clear | See "Known limitation" above — click Check for Updates to force reconciliation | Not itself an error; confirm actual installed version via the Status tab before assuming failure |

## Staged rollout (PR 7)

A release descriptor now carries `releaseId`, `channel` (`stable`|`pilot`),
`rolloutPercent` (0-100), and `forced`. Eligibility is decided **server-side**
(`server/src/services/imaging/bridgeUpdateConfig.ts`) before the bridge ever
sees a release — the bridge itself has no rollout logic, it just installs
whatever release it's offered.

- **Channel** is an exact match against the paired bridge's
  `ImagingBridgeAgent.updateChannel` (defaults to `stable`). A `pilot`
  release is never offered to a `stable` bridge and vice versa.
- **Cohort assignment** is `sha256(bridgeAgentId + ':' + releaseId)`, first 4
  bytes as a big-endian uint32, mod 100, compared against `rolloutPercent`.
  Deterministic and reshuffled only by a new `releaseId` — never
  `Math.random()`, never re-rolled on repeated checks. See
  `computeRolloutBucket` in `bridgeUpdateConfig.ts`.
- **Kill switch**: `IMAGING_BRIDGE_UPDATE_ROLLOUT_PERCENT=0` stops offering
  the release to every bridge without touching `IMAGING_BRIDGE_UPDATE_MODE`
  (a rollout pause, not a full feature disable).
- **Forced/security releases** (`IMAGING_BRIDGE_UPDATE_FORCED=true`) bypass
  the rollout percentage but never bypass channel or
  `minimumSourceVersion` gating.
- Operational model: publish at a low percentage, watch
  `lastSuccessfulUploadAt`/`lastErrorCategory` on the newly-updated cohort's
  `ImagingBridgeAgent` rows, raise the percentage once satisfied, finish at
  100. This is deliberately not a campaign-management platform — one
  percentage knob, one channel split, no A/B experiment framework.

## Publisher trust-pin rotation (PR 7)

`Trust/PinnedPublisherThumbprints.Values` already supports holding two
simultaneous entries ("current" + "next") — this was designed in at PR 6
time specifically so PR 7 only has to populate/rotate values, not build a
mechanism. Rotation sequence, in order:

1. Obtain the new ("next") certificate's SHA-1 thumbprint.
2. Add it to `PinnedPublisherThumbprints.Values` **alongside** the current
   one — a normal, reviewable source change, ship the next Core binary.
   Both thumbprints are now accepted simultaneously.
3. Confirm the new binary has reached the target adoption threshold
   (all/most paired bridges have updated past the release that shipped the
   dual-pin allowlist) before proceeding.
4. Start signing new releases with the "next" certificate and publish its
   thumbprint via `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT`.
5. Confirm successful updates against the new signer (a bridge's
   `AuthenticodeVerifier` check against the pinned set, plus the
   `UntrustedPublisher` error category rate, are the observable signals).
6. Only after that: remove the old ("current") thumbprint from the compiled
   list in a later release — never in the same release that started signing
   with "next" (that would strand any bridge that hasn't updated yet the
   moment its cached prior release descriptor pointed at the old signer).

Rejected/never done: an empty production pin list is fail-closed by design
(every release is `UntrustedPublisher` until deliberately populated); a
server-supplied thumbprint alone can never expand this local allowlist,
regardless of what `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` declares —
see `PinnedPublisherThumbprintsTests` for the compiled-list sanity checks
(well-formed, no duplicates, at most 2 simultaneous entries).

## One-step rollback (PR 7)

**Design:** before installing a newer release, the bridge downloads and
independently verifies the server-declared `rollback` package
(`IMAGING_BRIDGE_ROLLBACK_*` env vars) and caches it under
`updates\rollback\` — a single entry, hash+signer already checked at cache
time. This happens whether or not the upcoming install ever fails, so a
rollback target is available **without needing the backend reachable** at
the moment a rollback decision is made (deliberate — a clinic with no
internet must never be unable to roll back, and must never have a rollback
triggered merely because the backend is unreachable).

**Trigger (fully automatic, never IPC-triggerable):**
`BridgeOrchestrator.Start()` calls a crash-loop-only health check
(`PostUpdateHealthTracker`) immediately after every Service start. If the
currently-installed version matches the update state's `OfferedVersion` from
a just-`Succeeded` self-update, and this same version has now restarted more
than 3 times inside a 10-minute stabilization window, the Service launches a
rollback. This is deliberately the *only* signal used — not backend/
heartbeat reachability (see above), not a manual Manager button (there is no
`TriggerRollback` IPC operation; `RollbackManager.TryPrepareRollback` is only
ever called from this one internal code path).

**Mechanics:** `RollbackManager.TryPrepareRollback` re-verifies the cached
installer's hash and signer independently (defense in depth, same rationale
as `UpdateHelperRunner`'s re-check of the forward-update path), confirms the
cached version differs from the one being rolled back from, and is
single-flight + loop-prevented (a rollback already attempted — success or
failure — for a given offered version is never retried automatically for
that same version). The actual execution
(`UpdateHelperRunner.RunRollbackAsync`, in the same `NoraMedi.Bridge.
UpdateHelper.exe` process, invoked with a `rollback <instructionPath>`
argument) **uninstalls the currently-installed product first**
(`WindowsMsiProductUninstaller`, via `MsiEnumRelatedProductsW` against the
installer's fixed `UpgradeCode`, then `msiexec /x <productCode> /quiet
/norestart`) before installing the cached rollback package — this is
required because `Package.wxs`'s `MajorUpgrade` element sets
`DowngradeErrorMessage`, so a plain silent-install of an older MSI over a
newer one is refused by Windows Installer.

**Guarantees:**
- Only ever restores the exact version cached immediately before the
  now-failing install — never an arbitrary/caller-chosen version.
- Hash- and signer-verified against the bridge's own compiled-in trust
  anchor, independently, at both cache time and rollback time.
- Single-flight; a rollback loop for the same failed version is refused
  (`RollbackErrorCategory.LoopPrevented`) — the machine surfaces
  `InterventionRequired` instead of retrying forever.
- `%ProgramData%\NoraMediBridge` (credential, installation ID, queue, spool,
  bindings, config override) is never touched by any part of the rollback
  path — only Program Files binaries and the MSI registration change.

**Explicit limitation — not a transactional swap:** uninstall-then-install
is two separate Windows Installer transactions, not one atomic operation.
There is a real, if narrow, window between the uninstall completing and the
rollback install starting during which the product is not registered/
running at all. A power loss or forced shutdown exactly inside that window
requires manual recovery (reinstall via a signed installer) — this script/
mechanism does not and cannot claim otherwise. This is the correct, honest
statement of what Windows Installer's own `DowngradeErrorMessage` guard
allows us to build without inventing a custom non-MSI deployment mechanism.

## Immediate startup reconciliation for rollback

`RollbackStateStore.ReconcileOnStartup()` and
`BridgeOrchestrator.TryReconcileRollbackHelperResult()` are both called
synchronously in `Start()`, before the health-check crash-loop counter is
even evaluated — a rollback interrupted by a crash mid-flight is
reclassified as `InterventionRequired` immediately, and a rollback helper
result waiting from just before the last restart is reconciled to its true
terminal state without waiting for anything.

## Production certificate status

No real NoraMedi production Authenticode code-signing certificate exists in
this repository or has been provisioned as of this PR.
`Trust/PinnedPublisherThumbprints.Values` ships **empty**, and the protected
`windows-bridge-release.yml` GitHub Actions workflow fails immediately (before
touching publish/build/sign) if `NORAMEDI_SIGNING_THUMBPRINT`/
`NORAMEDI_TIMESTAMP_URL` secrets are not configured on the `production`
environment. This is the documented external operations gate, not an
unresolved code vulnerability — every code-controlled release gate (signing
pipeline, trust rotation mechanism, staged rollout, rollback, CI) is closed
and testable today against an ephemeral local test certificate.

Exact steps required to close this gate, once a real certificate is
available:
1. Acquire an Authenticode code-signing certificate from a publicly trusted
   CA (EV recommended for immediate SmartScreen reputation), ideally backed
   by an HSM or a cloud-signing KSP so the private key is never exportable.
2. Note its SHA-1 thumbprint.
3. Add that thumbprint to `Trust/PinnedPublisherThumbprints.Values` (a
   normal, reviewable source change — see "Publisher trust-pin rotation"
   above) and ship it in a Core release.
4. Configure `NORAMEDI_SIGNING_THUMBPRINT` and `NORAMEDI_TIMESTAMP_URL` as
   secrets on the repository's `production` GitHub Environment (with
   required-reviewer protection configured in repo settings — this workflow
   file cannot itself grant that protection).
5. Provision the certificate into the release runner's certificate store
   (or configure whatever cloud-KSP/HSM integration the runner uses).
6. Run `windows-bridge-release.yml` via manual dispatch.

Until all six steps are done, "production auto-update enablement" is the
only thing blocked — every other part of this PR is code-complete, tested,
and (per §Physical acceptance below) hardware-validated against an ephemeral
certificate.
