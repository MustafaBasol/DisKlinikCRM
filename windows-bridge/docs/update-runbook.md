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

**Known limitation:** the background loop's own `TryReconcileHelperResult`
call is what picks up a late-arriving helper result and corrects a
transient `Interrupted` status to the true `Succeeded`/`RebootRequired`/
`InstallFailed` outcome. In production, the loop's first post-restart tick
is delayed by `StartupJitterSeconds` (default up to 10 minutes), so a
freshly-restarted Manager can show "interrupted, check again" for up to
that long even though the update actually succeeded, until either that
tick runs or the user clicks **Check for Updates** themselves (which
reconciles immediately). Tightening this window is a PR 7 candidate.

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

## Scope exclusions reserved for PR 7

- Production signing-certificate acquisition/HSM integration.
- Rollback/auto-revert of a failed installation.
- Staged rollout percentages/channels (the `mode`/`minimumSourceVersion`
  fields leave room for this; no rollout logic exists yet).
- Shortening the "Interrupted may persist until next check" window
  (see above).
