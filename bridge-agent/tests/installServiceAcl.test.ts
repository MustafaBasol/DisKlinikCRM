/**
 * installServiceAcl.test.ts — source-regression test for install-service.ps1's
 * token-file ACL. A pilot install on French Windows failed because the script
 * granted access to the literal (English-only) group name "Administrators" —
 * which icacls cannot resolve on a non-English system. Fixed by switching to
 * well-known, locale-independent SIDs (SYSTEM = S-1-5-18, built-in
 * Administrators = S-1-5-32-544). This test greps the script source so a
 * future edit can't silently reintroduce a localized name.
 *
 * Run with: tsx tests/installServiceAcl.test.ts
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test, section, summarizeAndExit, src } from './testHarness.js';

const scriptsDir = fileURLToPath(new URL('../scripts/', import.meta.url));
const installScript = src('install-service.ps1', scriptsDir);

const icaclsLines = installScript
  .split(/\r?\n/)
  .filter(line => /icacls|IcaclsArgs/.test(line));

async function main() {
  section('well-known SIDs are used for token-file ACLs');

  await test('references the SYSTEM well-known SID (S-1-5-18)', () => {
    assert.match(installScript, /S-1-5-18/);
  });

  await test('references the built-in Administrators well-known SID (S-1-5-32-544)', () => {
    assert.match(installScript, /S-1-5-32-544/);
  });

  await test('grants read to the SYSTEM SID and full control to the Administrators SID', () => {
    assert.match(installScript, /\$SYSTEM_SID\s*=\s*"\*S-1-5-18"/);
    assert.match(installScript, /\$ADMINISTRATORS_SID\s*=\s*"\*S-1-5-32-544"/);
    assert.match(installScript, /ADMINISTRATORS_SID\}?:\(F\)/);
  });

  section('no localized account/group name is passed to icacls');

  await test('no icacls invocation references the literal name "Administrators"', () => {
    const offending = icaclsLines.filter(line => /["'(]Administrators/.test(line));
    assert.deepEqual(offending, [], `icacls lines still reference a localized group name: ${offending.join(' | ')}`);
  });

  await test('no icacls invocation references the literal name "SYSTEM" (use the SID instead)', () => {
    const offending = icaclsLines.filter(line => /["'(]SYSTEM/.test(line));
    assert.deepEqual(offending, [], `icacls lines still reference the literal SYSTEM name: ${offending.join(' | ')}`);
  });

  section('ACL failures fail the installation clearly');

  await test('icacls calls are wrapped so a non-zero exit throws', () => {
    assert.match(installScript, /Invoke-IcaclsOrFail/);
    assert.match(installScript, /\$LASTEXITCODE -ne 0/);
    assert.match(installScript, /throw "Failed to/);
  });

  await test('the ACL failure path never interpolates the token value into the thrown message', () => {
    const throwLine = installScript
      .split(/\r?\n/)
      .find(line => line.includes('throw "Failed to')) ?? '';
    assert.ok(!/plainToken|secureToken|bstr/i.test(throwLine));
  });

  summarizeAndExit();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
