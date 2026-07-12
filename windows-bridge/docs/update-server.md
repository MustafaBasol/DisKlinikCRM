# NoraMedi Windows Bridge — Auto-Update Server Contract (PR 6/7)

## Endpoint

`GET /api/public/imaging/bridge/update`

- Authenticated with the paired bridge's own bearer credential (the same
  token used for `/bootstrap` and `/heartbeat` — see `docs/security.md`).
  A missing/unknown/revoked token gets the same generic `401` as every
  other bridge endpoint.
- Rate-limited per token hash (`imaging-bridge-update-token`, 10/min) —
  the background loop only polls every `CheckIntervalMinutes`, so this is
  a generous ceiling against a misbehaving/compromised agent, not a
  legitimate-traffic constraint.
- Response is the same for every caller (no clinic-specific fields) — the
  release descriptor is a single global configuration, not per-tenant data,
  so there is nothing clinic-scoped to leak between callers.

Response shape (`server/src/services/imaging/bridgeUpdateConfig.ts`):

```json
{
  "mode": "disabled" | "notify" | "automatic",
  "release": {
    "version": "0.4.8",
    "downloadUrl": "https://cdn.noramedi.com/bridge/NoraMediBridgeSetup-0.4.8.exe",
    "sha256": "<64-char lowercase hex>",
    "signed": true,
    "publisherThumbprint": "<40-char hex Authenticode cert thumbprint>",
    "minimumSourceVersion": "0.4.0",
    "notes": "Adds secure auto-update."
  }
}
```

`release` is `null` whenever the mode is `disabled`, or the configured
metadata is malformed/incomplete (fail closed — see below).

## Canonical validation

All version/URL/hash parsing lives in one place,
`server/src/services/imaging/releaseMetadataValidation.ts`, shared with
`bridgeOnboardingConfig.ts` (the unauthenticated web-onboarding installer
card, PR 5). Neither file re-implements these checks — see the source
regression tests in `imagingBridgeUpdate.test.ts` that assert this.

## Environment variables

All in `server/.env.example`. Every one of these is read fresh on each
request (no restart-only caching) except that the Node process itself only
re-reads `process.env` at request time, so a running server does need a
restart to pick up a changed `.env` file.

| Variable | Required | Notes |
|---|---|---|
| `IMAGING_BRIDGE_UPDATE_MODE` | No (default `disabled`) | `disabled` \| `notify` \| `automatic`. Unrecognized value → `disabled`. |
| `IMAGING_BRIDGE_UPDATE_VERSION` | For `notify`/`automatic` | `x.y.z` or `x.y.z.w`. |
| `IMAGING_BRIDGE_UPDATE_DOWNLOAD_URL` | For `notify`/`automatic` | HTTPS required in production; `http://localhost`/`127.0.0.1` accepted only outside production. |
| `IMAGING_BRIDGE_UPDATE_SHA256` | For `notify`/`automatic` | 64-char lowercase hex. |
| `IMAGING_BRIDGE_UPDATE_SIGNED` | No (default `false`) | Must be `true`, with a valid thumbprint below, for the release to be offered **at all** in production — an unsigned release is never offered in production regardless of mode. |
| `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` | When signed=true | 40-char hex Authenticode certificate thumbprint. This is the release's declared trust anchor — the bridge pins **this value**, not a separate client-side config, so key rotation is a pure server-side deploy (see "Key rotation" below). |
| `IMAGING_BRIDGE_UPDATE_MIN_SOURCE_VERSION` | No | If set, a bridge running an older version than this is told `Unsupported` rather than offered the release. |
| `IMAGING_BRIDGE_UPDATE_NOTES` | No | Free text surfaced in the Manager. |

## Update modes

- **`disabled`** (default) — `CheckForUpdates` always resolves to a typed
  "disabled" state. No download URL, hash, or version is ever exposed to a
  bridge in this mode, even if the other env vars are set (an operator's
  half-finished config can't accidentally leak into the wire response).
- **`notify`** — the bridge downloads and verifies a newer release
  automatically (so the Manager can immediately show "ready to install"),
  but only an explicit, admin-gated `InstallUpdate` triggers the actual
  install.
- **`automatic`** — additionally allows the background loop to launch the
  install itself, subject to the queue-drain-safety check (never while an
  item is actively uploading).

## Key rotation

Rotating the signing certificate is an operational, server-side-only
change:

1. Generate/acquire the new certificate; note its thumbprint.
2. Update `IMAGING_BRIDGE_UPDATE_PUBLISHER_THUMBPRINT` to the new
   thumbprint **before** publishing any release signed with the new key.
3. Deploy the new release, signed with the new certificate, with
   `IMAGING_BRIDGE_UPDATE_SHA256` matching that exact signed file.

A bridge that already fetched the *old* thumbprint mid-rotation simply
fails closed (`WrongPublisher`) against a release signed by the
not-yet-published new key — safe direction to fail. There is no in-band
rotation message and no dual-thumbprint transition window in this PR; if a
zero-downtime rotation window is ever needed, that's a PR 7 candidate, not
implemented here.

## Tenant isolation

The response carries no clinic identifier, patient data, or agent-specific
field — it is the same descriptor for every authenticated caller. "Tenant
isolation" for this endpoint therefore reduces to: authentication is
required (no clinic can query another clinic's *anything* through this
endpoint, because there is nothing clinic-specific to query), and a
revoked/invalid credential is rejected identically to every other bridge
endpoint.
