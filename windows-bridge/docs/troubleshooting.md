# NoraMedi Windows Bridge — Troubleshooting

This PR ships Core + Service only — no Manager UI yet. Everything below is
diagnosed via the Named Pipe IPC surface (`Ipc/PipeOperation.cs`), which the
future Manager app (PR 3) will present as a normal UI. Until then, these
operations can be exercised with `NoraMedi.Bridge.Core.Ipc.BridgePipeClient.SendAsync`
from a `dotnet script`/test harness, or the future Manager.

| Symptom | Check |
|---|---|
| `GetServiceStatus` returns `connectionState: "disabled"` | The feature flag (`BridgeSelfService:Enabled`) is false — this is the default until the full 7-PR release gate passes. Not a bug. |
| `GetServiceStatus` returns `paired: false` | No credential has been provisioned yet. Call `ProvisionWithPairingCode` with a code generated in NoraMedi (Ayarlar → Görüntüleme → Cihaz Bağla, once PR 5 ships the onboarding UI). |
| `GetServiceStatus` returns `authState: "invalid"` | The stored credential was rejected (401) — most likely the bridge agent record was revoked in NoraMedi. Re-provision with a fresh pairing code; no service restart is needed, it recovers automatically once a new credential is written. |
| `pendingCount` keeps growing | Check `connectionState` — if `offline`, the server/network is unreachable or the credential is invalid. Check `GetQueueSummary` for `failed` count too. |
| A specific `watchId` shows `available: false` in `GetBindings` | The bound folder does not currently exist or is not readable by the service's account. Run `ValidateFolder` for the exact reason (`Exists`/`Readable`/`Message`). |
| `failedCount` is non-zero | Use `ExportDiagnostics` for the redacted summary, then `RetryFailedItem` with the ingestKey once the underlying cause (unknown device, oversized file, etc.) is fixed. |
| Service won't start | Check `journal_mode` — this queue deliberately uses `TRUNCATE`, not `WAL`, because WAL requires a memory-mapped `-shm` file that some AV/EDR products and restricted/virtualized filesystems block, which can hang the SQLite connection open. If this project's queue database ever needs to change journal modes again, test against a real `C:\ProgramData` path, not just a temp directory — this exact hang did not reproduce in a temp dir during development, only against ProgramData. |
| Uploads always fail with `bad_request`/`device_not_found` | The bound `deviceId` no longer exists (or was deactivated) in NoraMedi, or the file content doesn't match one of the four accepted types (JPEG/PNG/WebP/DICOM Part-10) — raw/preamble-less DICOM is intentionally rejected in this phase. |
| A file is dropped but never queued | Check the extension against `Validation.FileSignatureValidator.WatchedExtensions`, and confirm the file isn't named with a leading dot or a `.tmp`/`.part`/`.partial`/`.crdownload` suffix (all deliberately ignored, matching the Node agent). |

## Diagnostics bundle contents

`ExportDiagnostics` returns exactly: agent version, installation ID,
started-at timestamp, connection/auth state, last heartbeat time, per-state
queue counts, and per-`watchId` availability. It never contains a folder
path, a credential, a patient identifier, an original file name, or a raw
DICOM tag — see `docs/security.md`'s redaction section. If something you
need for a real support case isn't in that list, that's a gap in this PR's
allowlist (`Diagnostics/DiagnosticsSnapshot.cs`), not something to route
around with a broader log dump.

## Known limitation of this PR's test suite

Named Pipe ACL enforcement (LocalSystem/Administrators/authenticated Users
only, no anonymous/remote) is implemented in production code
(`BridgePipeServer.CreateServerStream`) but cannot be *negatively* tested
from a same-process, same-user xUnit run — there is no way to spawn a
genuinely anonymous or cross-user pipe client from a single test process
without a second Windows account or a privilege-drop, neither of which is
available in CI. The positive path (an authenticated local connection
succeeds) is covered by every pipe test in this PR.
