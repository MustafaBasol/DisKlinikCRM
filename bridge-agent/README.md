# NoraMedi Imaging Bridge Agent

Folder-watching Windows background agent that uploads new JPEG/PNG/WebP/DICOM
Part-10 files from a dental clinic's imaging export folders to NoraMedi via
the `POST /api/public/imaging/bridge/studies` contract (see
[`docs/47-imaging-bridge-contract.md`](../docs/47-imaging-bridge-contract.md)).

This is **not a standalone executable** — it requires Node.js 20+ already
installed on the clinic PC. See
[`docs/48-imaging-bridge-agent.md`](../docs/48-imaging-bridge-agent.md) for
the full operator guide (installation, config, troubleshooting, pilot
checklist).

This package is fully independent from the root frontend and `server/`
backend — it has its own `package.json`/lockfile and is never built,
installed, or deployed by their scripts.

## Quick start (development)

```
npm install
npm run typecheck
npm test
npm run build            # -> dist/agent.cjs
npm run package           # -> release/noramedi-bridge-agent-<version>.zip
```

Foreground smoke test against a real config:

```
node dist/agent.cjs --config config/config.example.json
```

## Scope (this phase)

Folder-watch acquisition only. Not implemented: DICOM C-STORE, TWAIN/WIA,
vendor SDKs, PACS/DICOMweb, a job-polling worklist, or a bundled
MSI/standalone-runtime installer — see docs/48 for the full list.
