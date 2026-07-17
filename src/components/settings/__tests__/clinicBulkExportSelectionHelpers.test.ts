/**
 * clinicBulkExportSelectionHelpers.test.ts — KVKK-HIGH-004 (P0) explicit
 * clinic-selection logic for ClinicBulkExportSection.tsx.
 *
 * No React Testing Library / DOM test runner in this repo (see
 * src/pages/__tests__/bookingWidgetHelpers.test.ts) — the "never silently
 * select a clinic when the global switcher is 'all'" invariant is verified
 * at the level of the extracted pure functions the component actually
 * calls.
 *
 * Run with: tsx src/components/settings/__tests__/clinicBulkExportSelectionHelpers.test.ts
 */

import assert from 'node:assert/strict';

import fs from 'node:fs/promises';
import {
  resolveExplicitClinicId,
  isClinicSelectionValid,
  initialClinicBulkExportState,
  isRequestStillCurrent,
  type ClinicOption,
} from '../clinicBulkExportSelectionHelpers';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  const clinicA: ClinicOption = { id: 'clinic-a', name: 'Clinic A' };
  const clinicB: ClinicOption = { id: 'clinic-b', name: 'Clinic B' };
  const clinics = [clinicA, clinicB];

  section('1. All-clinics mode never auto-selects a clinic');

  await test('global "all" with no prior selection resolves to empty (forces an explicit in-section pick)', () => {
    assert.equal(resolveExplicitClinicId('all', clinics, ''), '');
  });

  await test('global "all" does not clear an already-made in-section selection', () => {
    // The user picked clinic B explicitly in-section; the global switcher
    // being (or becoming) "all" must not silently override that choice —
    // only an explicit specific global selection or a dropped-access clinic
    // changes it.
    assert.equal(resolveExplicitClinicId('all', clinics, clinicB.id), clinicB.id);
  });

  section('2. A specific, accessible global selection is adopted');

  await test('a specific accessible global clinic id is adopted over no prior selection', () => {
    assert.equal(resolveExplicitClinicId(clinicA.id, clinics, ''), clinicA.id);
  });

  await test('a specific accessible global clinic id is adopted even over a DIFFERENT prior in-section selection (non-default clinic selection)', () => {
    assert.equal(resolveExplicitClinicId(clinicB.id, clinics, clinicA.id), clinicB.id);
  });

  await test('a global clinic id not in the accessible list is never adopted, even though it is not "all"', () => {
    assert.equal(resolveExplicitClinicId('inaccessible-clinic', clinics, ''), '');
    assert.equal(resolveExplicitClinicId('inaccessible-clinic', clinics, clinicA.id), clinicA.id, 'a prior valid in-section selection must be kept');
  });

  section('3. Access-list changes clear a selection that has fallen out of it');

  await test('a previously valid in-section selection is cleared once it drops out of availableClinics', () => {
    assert.equal(resolveExplicitClinicId('all', [clinicB], clinicA.id), '', 'clinic A is no longer accessible — must clear, never keep a dangling id');
  });

  await test('an empty availableClinics list always resolves to empty, regardless of global selection', () => {
    assert.equal(resolveExplicitClinicId(clinicA.id, [], ''), '');
    assert.equal(resolveExplicitClinicId('all', [], clinicA.id), '');
  });

  section('4. isClinicSelectionValid mirrors the same accessible-list rule');

  await test('empty clinicId is never valid', () => {
    assert.equal(isClinicSelectionValid('', clinics), false);
  });

  await test('a clinicId present in availableClinics is valid; one absent from it is not', () => {
    assert.equal(isClinicSelectionValid(clinicA.id, clinics), true);
    assert.equal(isClinicSelectionValid('someone-elses-clinic', clinics), false);
  });

  section('5. State reset on clinic change clears every sensitive/transient field');

  await test('initialClinicBulkExportState returns a fully-cleared shape every call (no shared/mutated reference)', () => {
    const first = initialClinicBulkExportState();
    const second = initialClinicBulkExportState();
    assert.deepEqual(first, second);
    assert.notEqual(first, second, 'must be a fresh object each call, not a shared singleton a caller could accidentally mutate');

    const expectedKeys = [
      'activeJobId',
      'password',
      'confirmChecked',
      'downloadPassword',
      'downloadError',
      'submitError',
      'purpose',
      'restrictedNote',
      'enabled',
      'configError',
    ].sort();
    assert.deepEqual(Object.keys(first).sort(), expectedKeys, 'the reset shape must cover exactly the fields the component resets on clinic change — a regression guard if a new piece of state is added without wiring it into the reset');

    assert.equal(first.activeJobId, null);
    assert.equal(first.password, '');
    assert.equal(first.confirmChecked, false);
    assert.equal(first.downloadPassword, '');
    assert.equal(first.downloadError, null);
    assert.equal(first.submitError, null);
    assert.equal(first.purpose, '');
    assert.equal(first.restrictedNote, '');
    assert.equal(first.enabled, null);
    assert.equal(first.configError, null);
  });

  section('6. isRequestStillCurrent — the P0 stale cross-clinic async-response guard');

  await test('matching clinicId and epoch is current', () => {
    assert.equal(isRequestStillCurrent(clinicA.id, 0, clinicA.id, 0), true);
  });

  await test('a different live clinicId (epoch unchanged) is stale', () => {
    assert.equal(isRequestStillCurrent(clinicA.id, 0, clinicB.id, 0), false);
  });

  await test('a bumped live epoch (same clinicId, e.g. re-selecting after an invalid interim state) is stale', () => {
    assert.equal(isRequestStillCurrent(clinicA.id, 0, clinicA.id, 1), false);
  });

  await test('both clinicId and epoch changed is stale', () => {
    assert.equal(isRequestStillCurrent(clinicA.id, 0, clinicB.id, 1), false);
  });

  section('7. Stale cross-clinic async-response scenarios (simulated await/race, no DOM harness)');

  /**
   * Mirrors the exact pattern ClinicBulkExportSection.tsx's handleCreate/
   * handleDownload use: capture {clinicId, epoch} before the first await,
   * re-check with isRequestStillCurrent after each await before applying
   * anything. `liveState` stands in for the component's
   * clinicIdRef.current/selectionEpochRef.current pair, which handleClinicChange
   * mutates the instant the user switches clinics — entirely independent of
   * when the in-flight network promise happens to resolve.
   */
  interface LiveSelection {
    clinicId: string;
    epoch: number;
  }

  function switchClinic(live: LiveSelection, nextClinicId: string): void {
    live.epoch += 1;
    live.clinicId = nextClinicId;
  }

  await test('clinic A create response arriving after switch to B is ignored (never applied to state)', async () => {
    const live: LiveSelection = { clinicId: clinicA.id, epoch: 0 };
    const requestClinicId = live.clinicId;
    const requestEpoch = live.epoch;

    let resolveCreate!: (jobId: string) => void;
    const createPromise = new Promise<string>((resolve) => {
      resolveCreate = resolve;
    });

    let appliedJobId: string | null = null;
    const opPromise = (async () => {
      const jobId = await createPromise;
      if (!isRequestStillCurrent(requestClinicId, requestEpoch, live.clinicId, live.epoch)) return;
      appliedJobId = jobId; // stand-in for setActiveJobId(...)
    })();

    // The user switches to clinic B WHILE clinic A's create request is still in flight.
    switchClinic(live, clinicB.id);
    resolveCreate('job-from-clinic-a');
    await opPromise;

    assert.equal(appliedJobId, null, 'a create response for an abandoned clinic must never become the active job');
  });

  await test('clinic A token response arriving after switch to B never issues the follow-up download request', async () => {
    const live: LiveSelection = { clinicId: clinicA.id, epoch: 0 };
    const requestClinicId = live.clinicId;
    const requestEpoch = live.epoch;

    let resolveToken!: (token: string) => void;
    const tokenPromise = new Promise<string>((resolve) => {
      resolveToken = resolve;
    });

    let downloadRequestIssued = false;
    const opPromise = (async () => {
      const token = await tokenPromise;
      if (!isRequestStillCurrent(requestClinicId, requestEpoch, live.clinicId, live.epoch)) return;
      downloadRequestIssued = true; // stand-in for clinicBulkExportService.download(...)
      void token;
    })();

    switchClinic(live, clinicB.id);
    resolveToken('raw-token-for-clinic-a');
    await opPromise;

    assert.equal(downloadRequestIssued, false, 'switching clinics after the token arrives must prevent the follow-up download request from ever being issued');
  });

  await test('clinic A blob response arriving after switch to B never triggers the browser download', async () => {
    const live: LiveSelection = { clinicId: clinicA.id, epoch: 0 };
    const requestClinicId = live.clinicId;
    const requestEpoch = live.epoch;

    let resolveBlob!: (blob: unknown) => void;
    const blobPromise = new Promise<unknown>((resolve) => {
      resolveBlob = resolve;
    });

    let downloadTriggered = false;
    const opPromise = (async () => {
      const blob = await blobPromise;
      if (!isRequestStillCurrent(requestClinicId, requestEpoch, live.clinicId, live.epoch)) return;
      downloadTriggered = true; // stand-in for createObjectURL + synthetic-anchor click
      void blob;
    })();

    switchClinic(live, clinicB.id);
    resolveBlob({ fakeBlob: true });
    await opPromise;

    assert.equal(downloadTriggered, false, 'a stale clinic-A blob response must never trigger a browser download after switching to clinic B');
  });

  await test('a response that resolves BEFORE any clinic switch is still applied (guard is not overly strict)', async () => {
    const live: LiveSelection = { clinicId: clinicA.id, epoch: 0 };
    const requestClinicId = live.clinicId;
    const requestEpoch = live.epoch;

    const jobId = await Promise.resolve('job-from-clinic-a');
    assert.equal(isRequestStillCurrent(requestClinicId, requestEpoch, live.clinicId, live.epoch), true, 'no switch happened — the response must still be considered current');
    assert.equal(jobId, 'job-from-clinic-a');
  });

  section('8. all-clinics mode never resolves to an implicit selection (regression guard)');

  await test('switching the global selector to "all" with no prior in-section pick leaves the selection empty', () => {
    assert.equal(resolveExplicitClinicId('all', clinics, ''), '', 'must never auto-select a clinic just because the global switcher is "all"');
  });

  section('9. ClinicBulkExportSection.tsx source-level guards (structural, no DOM harness)');

  async function readComponentSource(): Promise<string> {
    return fs.readFile(new URL('../ClinicBulkExportSection.tsx', import.meta.url), 'utf8');
  }

  await test('handleCreate captures {clinicId, epoch} and re-checks isStillCurrentSelection after the await, before setActiveJobId', async () => {
    const source = await readComponentSource();
    const fnStart = source.indexOf('const handleCreate = useCallback');
    const fnEnd = source.indexOf('const handleDownload = useCallback');
    assert.ok(fnStart > -1 && fnEnd > fnStart);
    const body = source.slice(fnStart, fnEnd);
    assert.ok(body.includes('const requestClinicId = clinicId'));
    assert.ok(body.includes('const requestEpoch = selectionEpochRef.current'));
    const guardIndex = body.indexOf('isStillCurrentSelection(requestClinicId, requestEpoch)');
    const setActiveJobIdIndex = body.indexOf('setActiveJobId(response.data?.jobId');
    assert.ok(guardIndex > -1 && setActiveJobIdIndex > guardIndex, 'the guard must be checked BEFORE setActiveJobId is ever called with the response');
  });

  await test('handleDownload re-checks isStillCurrentSelection after BOTH the token await and the blob await, before issuing/using either result', async () => {
    const source = await readComponentSource();
    const fnStart = source.indexOf('const handleDownload = useCallback');
    const fnEnd = source.indexOf('const handleStartNew = useCallback');
    assert.ok(fnStart > -1 && fnEnd > fnStart);
    const body = source.slice(fnStart, fnEnd);
    const guardCount = (body.match(/isStillCurrentSelection\(requestClinicId, requestEpoch\)/g) ?? []).length;
    assert.ok(guardCount >= 2, 'must guard both after the token request and after the blob download request');
    const tokenAwaitIndex = body.indexOf('requestDownloadToken(');
    const firstGuardIndex = body.indexOf('isStillCurrentSelection(requestClinicId, requestEpoch)');
    const downloadAwaitIndex = body.indexOf('.download(requestClinicId, requestJobId, token)');
    const secondGuardIndex = body.indexOf('isStillCurrentSelection(requestClinicId, requestEpoch)', firstGuardIndex + 1);
    assert.ok(tokenAwaitIndex > -1 && firstGuardIndex > tokenAwaitIndex, 'first guard must come after the token await');
    assert.ok(downloadAwaitIndex > -1 && secondGuardIndex > downloadAwaitIndex, 'second guard must come after the blob download await');
    assert.ok(secondGuardIndex < body.indexOf('createObjectURL('), 'the guard must be checked before creating the object URL');
  });

  await test('handleStartNew clears every password/confirmation/download/error field and bumps the selection epoch', async () => {
    const source = await readComponentSource();
    const fnStart = source.indexOf('const handleStartNew = useCallback');
    const fnEnd = source.indexOf('if (!canEdit) return null');
    assert.ok(fnStart > -1 && fnEnd > fnStart);
    const body = source.slice(fnStart, fnEnd);
    for (const requiredCall of [
      'selectionEpochRef.current += 1',
      'setActiveJobId(null)',
      "setPassword('')",
      'setConfirmChecked(false)',
      "setDownloadPassword('')",
      'setDownloadError(null)',
      'setSubmitError(null)',
    ]) {
      assert.ok(body.includes(requiredCall), `handleStartNew must call ${requiredCall}`);
    }
  });

  await test('handleStartNew does NOT reset clinicId, enabled, or configError — only the currently selected clinic\'s config is retained', async () => {
    const source = await readComponentSource();
    const fnStart = source.indexOf('const handleStartNew = useCallback');
    const fnEnd = source.indexOf('if (!canEdit) return null');
    const body = source.slice(fnStart, fnEnd);
    assert.ok(!body.includes('setClinicId('), 'must never change the selected clinic itself');
    assert.ok(!body.includes('setEnabled('), 'must retain the current enabled config, not reset it');
    assert.ok(!body.includes('setConfigError('), 'must retain the current config error state, not reset it');
  });

  await test('the switcher-sync effect never nests resetForClinicChange (or any other setState side effect) inside a setClinicId functional updater', async () => {
    const source = await readComponentSource();
    assert.ok(!/setClinicId\(\s*\(/.test(source), 'must never call setClinicId with a functional updater — state updates must stay side-effect free (P0)');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
