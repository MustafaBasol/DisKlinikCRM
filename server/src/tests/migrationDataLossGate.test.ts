/**
 * migrationDataLossGate.test.ts — F3-DATA-MIG-TODAY-001-R9-DATA-LOSS-GATE
 *
 * The proof for the FIRST-CUSTOMER DATA-LOSS GATE.
 *
 * The claim under test is narrow and absolute: no source column carrying
 * MEANINGFUL data may fail to arrive in NoraMedi unless a named Platform Admin
 * decided, on this run, that it would not. A profile that recommends IGNORE, an
 * engine that reports BLOCKED and an unresolved legal gate are recommendations.
 * None of them is that decision.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM migrationMapping.test.ts. The R7/R8
 * accounting lived inside that suite and re-implemented its own classification
 * (`accountingClassOf`) over invented fill counts. A test that reimplements the
 * logic it is checking can only ever prove the reimplementation self-consistent
 * — which is exactly what happened, and why an accounting that balanced
 * perfectly still described 68 columns nobody had decided anything about. This
 * suite calls the SHIPPING gate (dataLossGate.ts) and feeds it the REAL
 * measured fill evidence (firstCustomerMeasuredFill.ts).
 *
 * PRIVACY. Every fixture here is synthetic or a vendor COLUMN NAME. No cell
 * value, no patient, no sample from the first-customer workbook.
 */

import assert from 'node:assert/strict';
import {
  DESTINATION_FIELDS,
  MAPPING_STATES,
  getDestinationField,
  type SourceColumnProfile,
} from '../services/migration/contracts.js';
import {
  HISTORICAL_EVIDENCE_DESTINATION_GROUP,
  classifyColumn,
  evaluateDataLossGate,
  filledCountOf,
  isOperatorConfirmed,
  type DataLossGateRecord,
} from '../services/migration/mapping/dataLossGate.js';
import { FIRST_CUSTOMER_MATRIX } from '../services/migration/mapping/firstCustomerMatrix.js';
import {
  FIRST_CUSTOMER_MEASURED_FILL,
  FIRST_CUSTOMER_NAMED_COLUMNS,
  FIRST_CUSTOMER_TOTAL_ROWS,
  FIRST_CUSTOMER_WORKBOOK_SHA256,
  fillEvidenceClassOf,
  informationContentCounts,
  measuredFillCounts,
  measuredFillFor,
} from '../services/migration/mapping/firstCustomerMeasuredFill.js';

// ─── Test harness (same shape as sibling suites) ────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error)?.stack ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const OPERATOR_ID = 'platform-admin-fixture-id';

/** A `SourceColumnProfile` shaped exactly as the analyzer persists it. */
function profile(filledCount: number, index = 0, header = 'COL'): SourceColumnProfile {
  return {
    index,
    header,
    filledCount,
    totalRows: FIRST_CUSTOMER_TOTAL_ROWS,
    fillRate: Number((filledCount / FIRST_CUSTOMER_TOTAL_ROWS).toFixed(4)),
    distinctCount: filledCount,
    typeCounts: { empty: 0, string: filledCount, number: 0, date: 0, boolean: 0, error: 0 },
    maxLength: 10,
  };
}

/** A mapping row as the ANALYZE route writes it: a system recommendation. */
function systemProposed(over: Partial<DataLossGateRecord> = {}): DataLossGateRecord {
  return {
    sourceField: 'SOME_COLUMN',
    state: 'IGNORE',
    destinationField: null,
    sourceProfile: profile(1),
    isAutoSuggested: true,
    decidedByPlatformAdminId: null,
    decidedAt: null,
    ...over,
  };
}

/** The same row after an operator saved it in the mapping screen. */
function operatorDecided(over: Partial<DataLossGateRecord> = {}): DataLossGateRecord {
  return {
    ...systemProposed(over),
    isAutoSuggested: false,
    decidedByPlatformAdminId: OPERATOR_ID,
    decidedAt: new Date('2026-08-20T09:00:00.000Z'),
    ...over,
  };
}

async function main() {
  // ========================================================================
  section('R9-1. A SYSTEM RECOMMENDATION IS NOT AN OPERATOR DECISION');
  // ========================================================================

  await test('#1: a system IGNORE recommendation does NOT count as an explicit exclusion', () => {
    // The exact shape the analyze route persists for a matrix-driven IGNORE.
    const row = systemProposed({ sourceField: 'SUBE_ID', sourceProfile: profile(9_083) });

    assert.equal(isOperatorConfirmed(row), false, 'nobody decided this — it arrived from the profile');
    const column = classifyColumn(row);
    assert.equal(column.disposition, 'SYSTEM_RECOMMENDED_EXCLUSION');
    assert.equal(column.blocksExecute, true);

    const report = evaluateDataLossGate([row]);
    assert.equal(
      report.operatorConfirmedExcluded,
      0,
      'a recommendation must never be counted as an operator-confirmed exclusion',
    );
    assert.equal(report.systemRecommendedButUnconfirmedExclusions, 1);
    assert.deepEqual(report.unconfirmedExclusionFields, ['SUBE_ID']);
    assert.equal(report.satisfied, false);
  });

  await test('#2: a meaningful ignored column blocks Execute until the operator confirms it', () => {
    const before = systemProposed({ sourceField: 'AILEGURUBU', sourceProfile: profile(14_890) });
    assert.equal(evaluateDataLossGate([before]).satisfied, false, 'unconfirmed: must block');

    // The operator opens the mapping screen, leaves it ignored, and saves.
    // That is the whole confirmation workflow — no new state, no new screen.
    const after = operatorDecided({ sourceField: 'AILEGURUBU', sourceProfile: profile(14_890) });
    const report = evaluateDataLossGate([after]);
    assert.equal(classifyColumn(after).disposition, 'OPERATOR_CONFIRMED_EXCLUSION');
    assert.equal(report.operatorConfirmedExcluded, 1);
    assert.equal(report.systemRecommendedButUnconfirmedExclusions, 0);
    assert.equal(report.satisfied, true, 'a confirmed exclusion satisfies the gate');
  });

  await test('#2b: partial decision evidence is NOT a confirmation (fail-closed)', () => {
    // Each of these is a row that looks decided from one angle and is not.
    const partials: Array<[string, DataLossGateRecord]> = [
      [
        'flag cleared but no decider recorded',
        systemProposed({ isAutoSuggested: false }),
      ],
      [
        'decider recorded but the auto-suggested flag still set',
        systemProposed({ decidedByPlatformAdminId: OPERATOR_ID, decidedAt: new Date() }),
      ],
      [
        'decider and flag but no timestamp — not an auditable event',
        systemProposed({ isAutoSuggested: false, decidedByPlatformAdminId: OPERATOR_ID }),
      ],
      [
        'empty-string decider',
        systemProposed({ isAutoSuggested: false, decidedByPlatformAdminId: '  ', decidedAt: new Date() }),
      ],
    ];
    for (const [label, row] of partials) {
      assert.equal(isOperatorConfirmed(row), false, label);
      assert.equal(classifyColumn(row).disposition, 'SYSTEM_RECOMMENDED_EXCLUSION', label);
    }
  });

  await test('#3: a zero-data ignored column does NOT block, and is accounted separately', () => {
    // Measured empty. There is provably nothing to lose, so no human is asked
    // to confirm a non-event.
    const row = systemProposed({ sourceField: 'UZUNNOT', sourceProfile: profile(0) });
    assert.equal(classifyColumn(row).disposition, 'ZERO_DATA');
    assert.equal(classifyColumn(row).blocksExecute, false);

    const report = evaluateDataLossGate([row]);
    assert.equal(report.zeroDataColumns, 1);
    assert.equal(report.meaningfulSourceColumns, 0, 'zero-data is NOT folded into meaningful');
    assert.equal(report.operatorConfirmedExcluded, 0, 'nor is it counted as an exclusion anyone made');
    assert.equal(report.satisfied, true);
  });

  // ========================================================================
  section('R9-2. BLOCKED AND LEGAL_BLOCKED WITH REAL CONTENT');
  // ========================================================================

  await test('#4: a meaningful BLOCKED_NO_DESTINATION column blocks Execute', () => {
    const row = systemProposed({ sourceField: 'DOSYANO', state: 'BLOCKED', sourceProfile: profile(14_718) });
    const column = classifyColumn(row);
    assert.equal(column.disposition, 'BLOCKED_MEANINGFUL');
    assert.equal(column.blocksExecute, true);

    const report = evaluateDataLossGate([row]);
    assert.equal(report.blockedMeaningful, 1);
    assert.deepEqual(report.blockedMeaningfulFields, ['DOSYANO']);
    assert.equal(report.satisfied, false);
  });

  await test('#4b: BLOCKED is deliberately NOT confirmable in place — the operator must say what they decided', () => {
    // Stamping a decision on a BLOCKED row would record an OBSTACLE as if it
    // were a CHOICE. To exclude the column the operator moves it to IGNORE,
    // which records what they actually decided.
    const stamped = operatorDecided({ state: 'BLOCKED', sourceProfile: profile(500) });
    assert.equal(classifyColumn(stamped).disposition, 'BLOCKED_MEANINGFUL');
    assert.equal(classifyColumn(stamped).blocksExecute, true);

    const moved = operatorDecided({ state: 'IGNORE', sourceProfile: profile(500) });
    assert.equal(classifyColumn(moved).disposition, 'OPERATOR_CONFIRMED_EXCLUSION');
  });

  await test('#5: a meaningful LEGAL_BLOCKED column blocks — and the ONLY exception is unreachable today', () => {
    const row = systemProposed({ sourceField: 'ONEMLINOT', state: 'LEGAL_BLOCKED', sourceProfile: profile(6_805) });
    const report = evaluateDataLossGate([row]);
    assert.equal(classifyColumn(row).disposition, 'LEGAL_BLOCKED_MEANINGFUL');
    assert.equal(report.legalBlockedMeaningful, 1);
    assert.equal(report.satisfied, false, 'real content under an unresolved legal gate may not simply vanish');

    // Confirming it as an ordinary exclusion is NOT enough: consent and lawful
    // basis are not the operator's to grant, and preserving special-category
    // content as evidence needs an ACCEPTED destination for evidence.
    const confirmed = operatorDecided({ state: 'LEGAL_BLOCKED', sourceProfile: profile(6_805) });
    assert.equal(classifyColumn(confirmed).disposition, 'LEGAL_BLOCKED_MEANINGFUL');

    // The exception has a precise shape...
    assert.equal(HISTORICAL_EVIDENCE_DESTINATION_GROUP, 'historical_evidence');
    // ...and NO destination declares it, so it cannot fire by accident. Adding
    // one is a legal decision, and this assertion is what makes that decision
    // visible in review rather than silent.
    assert.deepEqual(
      DESTINATION_FIELDS.filter((d) => d.group === HISTORICAL_EVIDENCE_DESTINATION_GROUP).map((d) => d.key),
      [],
      'a historical-evidence destination would let special-category content pass the gate — it must be an explicit program-owner decision, never an accident',
    );

    // Zero-data legal-blocked columns are unaffected: KVKKONAYKODU / KVKKSMS
    // stay purely informational, exactly as R7 established.
    const empty = systemProposed({ sourceField: 'KVKKSMS', state: 'LEGAL_BLOCKED', sourceProfile: profile(0) });
    assert.equal(classifyColumn(empty).disposition, 'ZERO_DATA');
    assert.equal(evaluateDataLossGate([empty]).satisfied, true);
  });

  // ========================================================================
  section('R9-3. UNMEASURED FILL IS NOT EMPTY');
  // ========================================================================

  await test('#5b: a column whose fill was never measured blocks rather than passing as empty', () => {
    // Every one of these is "we do not know", and none of them is "zero".
    const unknowns: unknown[] = [undefined, null, {}, { filledCount: null }, { filledCount: '3' }, { filledCount: -1 }, { filledCount: 1.5 }, 'not json'];
    for (const sourceProfile of unknowns) {
      assert.equal(filledCountOf(sourceProfile), null, JSON.stringify(sourceProfile ?? null));
      const column = classifyColumn(systemProposed({ sourceProfile }));
      assert.equal(column.disposition, 'UNMEASURED_FILL');
      assert.equal(column.blocksExecute, true);
    }

    // A JSON STRING round-trip is still a real measurement and must parse.
    assert.equal(filledCountOf(JSON.stringify(profile(7))), 7);
    // And a genuine measured zero is genuinely zero.
    assert.equal(filledCountOf(profile(0)), 0);
  });

  await test('#5c: unmeasured columns are counted apart from both meaningful and zero-data', () => {
    const report = evaluateDataLossGate([
      systemProposed({ sourceField: 'UNVANI', state: 'BLOCKED', sourceProfile: null }),
      operatorDecided({ sourceField: 'HASTARENGI', sourceProfile: profile(3) }),
      systemProposed({ sourceField: 'UZUNNOT', sourceProfile: profile(0) }),
    ]);
    assert.equal(report.totalSourceColumns, 3);
    assert.equal(report.unmeasuredFillColumns, 1);
    assert.equal(report.zeroDataColumns, 1);
    assert.equal(report.meaningfulSourceColumns, 1);
    assert.deepEqual(report.unmeasuredFillFields, ['UNVANI']);
    assert.equal(report.satisfied, false, 'an unmeasured column cannot be shown to be safe to drop');
  });

  // ========================================================================
  section('R9-4. THE ACCOUNTING EQUATION OVER REAL MEASURED FILL');
  // ========================================================================

  await test('#6: the measured-fill evidence covers the matrix exactly, and is 49 / 42 / 0', () => {
    assert.equal(FIRST_CUSTOMER_MEASURED_FILL.length, FIRST_CUSTOMER_MATRIX.length);
    for (const e of FIRST_CUSTOMER_MATRIX) {
      assert.ok(measuredFillFor(e.sourceField), `no measured fill recorded for ${e.sourceField}`);
    }
    const counts = measuredFillCounts();
    // R10 REPLACES THE R9 HEADLINE. R9 asserted 23 / 10 / 58 because 58 columns
    // had genuinely never been profiled. R10 ran the repository's own analyze
    // code (parseSourceWorkbook + profileColumns) over the accepted workbook
    // (sha256 f08c0019…) and measured all 91, so UNMEASURED is now 0 and the
    // single largest blocker on the first-customer run is retired by EVIDENCE,
    // not by relaxing the gate. Asserted so it cannot drift unnoticed.
    assert.deepEqual(counts, { MEANINGFUL: 49, ZERO_DATA: 42, UNMEASURED: 0 });
    assert.equal(counts.MEANINGFUL + counts.ZERO_DATA + counts.UNMEASURED, 91);
    assert.equal(
      counts.UNMEASURED,
      0,
      'every named source column must stay measured — a regression here re-opens the R9 blocker',
    );

    // The evidence table and the workbook it was measured from are pinned
    // together, so a future re-measure against a DIFFERENT file cannot quietly
    // reuse these counts.
    assert.equal(FIRST_CUSTOMER_NAMED_COLUMNS, 91);
    assert.match(FIRST_CUSTOMER_WORKBOOK_SHA256, /^[0-9a-f]{64}$/);

    // Information content is reported ALONGSIDE the evidence class, never
    // instead of it: 10 columns are filled but carry one distinct value, so
    // they discriminate no patient from any other. That is decision-support
    // for the operator, not a decision — every one is still MEANINGFUL above.
    const info = informationContentCounts();
    assert.deepEqual(info, { NO_DATA: 42, CONSTANT: 10, VARYING: 39 });
    assert.equal(info.CONSTANT + info.VARYING, counts.MEANINGFUL);
    assert.equal(info.NO_DATA, counts.ZERO_DATA);

    console.log(
      `    measured fill: MEANINGFUL ${counts.MEANINGFUL} · ZERO_DATA ${counts.ZERO_DATA} · UNMEASURED ${counts.UNMEASURED}  (of ${FIRST_CUSTOMER_MATRIX.length})`,
    );
    console.log(
      `    information content: VARYING ${info.VARYING} · CONSTANT ${info.CONSTANT} · NO_DATA ${info.NO_DATA}`,
    );
  });

  await test('#6b: an operator-confirmed exclusion is auditable and counts EXACTLY once', () => {
    const rows = [
      operatorDecided({ sourceField: 'AILEGURUBU', sourceProfile: profile(14_890) }),
      operatorDecided({ sourceField: 'SUBE_ID', sourceProfile: profile(9_083) }),
      systemProposed({ sourceField: 'KAYITTARIHI', sourceProfile: profile(14_890) }),
    ];
    const report = evaluateDataLossGate(rows);

    assert.equal(report.operatorConfirmedExcluded, 2, 'two confirmations, counted twice, not four times');
    assert.equal(report.systemRecommendedButUnconfirmedExclusions, 1);
    assert.deepEqual(report.unconfirmedExclusionFields, ['KAYITTARIHI']);

    // AUDITABLE: each confirmation names a decider and a moment, and the gate
    // reads exactly those fields — it cannot conclude "confirmed" from anything
    // that is not a recorded human action.
    for (const row of rows.slice(0, 2)) {
      assert.equal(row.decidedByPlatformAdminId, OPERATOR_ID);
      assert.ok(row.decidedAt instanceof Date);
      assert.equal(row.isAutoSuggested, false);
    }

    // COUNTED ONCE: every column lands in exactly one class, so the equation
    // balances and no column can be double-counted into balance.
    assert.equal(
      report.meaningfulSourceColumns,
      report.resolved +
        report.manualReview +
        report.sensitiveReview +
        report.operatorConfirmedExcluded +
        report.systemRecommendedButUnconfirmedExclusions +
        report.blockedMeaningful +
        report.legalBlockedMeaningful +
        report.unaccountedMeaningful,
    );
    assert.equal(report.balanced, true);
  });

  await test('#6c: the REAL data-loss equation over the first-customer profile, today', () => {
    /*
     * The first-customer matrix as it stands, joined to the MEASURED fill, with
     * every row as the analyze route would first write it — a system
     * recommendation, nothing confirmed. This is the honest picture of where
     * the first customer actually is, and it must NOT be executable.
     */
    const rows: DataLossGateRecord[] = FIRST_CUSTOMER_MATRIX.map((e, i) => ({
      sourceField: e.sourceField,
      state: e.mappingState,
      destinationField: e.destinationField,
      sourceProfile: (() => {
        const fill = measuredFillFor(e.sourceField)!;
        return fill.filledCount === null ? null : profile(fill.filledCount, i, e.sourceField);
      })(),
      isAutoSuggested: true,
      decidedByPlatformAdminId: null,
      decidedAt: null,
    }));

    const report = evaluateDataLossGate(rows);

    assert.equal(report.totalSourceColumns, 91);
    assert.equal(report.meaningfulSourceColumns, 49);
    assert.equal(report.zeroDataColumns, 42);
    assert.equal(
      report.unmeasuredFillColumns,
      0,
      'R10: every column is measured, so nothing blocks merely for being unprofiled',
    );
    assert.equal(report.balanced, true, 'every meaningful column lands in exactly one class');
    assert.equal(
      report.satisfied,
      false,
      'THE POINT OF THIS TASK: the first customer is NOT execute-eligible today, and the gate says so',
    );

    console.log(
      `    meaningful ${report.meaningfulSourceColumns} = resolved ${report.resolved}` +
        ` + manualReview ${report.manualReview} + sensitiveReview ${report.sensitiveReview}` +
        ` + operatorConfirmedExcluded ${report.operatorConfirmedExcluded}` +
        ` + UNCONFIRMED ${report.systemRecommendedButUnconfirmedExclusions}` +
        ` + blocked ${report.blockedMeaningful} + legalBlocked ${report.legalBlockedMeaningful}` +
        ` + unaccounted ${report.unaccountedMeaningful}`,
    );
    console.log(
      `    separately: zero-data ${report.zeroDataColumns} · UNMEASURED (blocking) ${report.unmeasuredFillColumns}`,
    );
    console.log(`    unconfirmed exclusions: ${report.unconfirmedExclusionFields.join(', ')}`);
    console.log(`    blocked with data:      ${report.blockedMeaningfulFields.join(', ')}`);

    /*
     * R10: measuring all 91 columns did not make the picture rosier — it made
     * it HONEST, and bigger. Retiring 58 UNMEASURED columns moved 26 of them
     * into MEANINGFUL, which is why the blocking lists below GREW. Every entry
     * here is a real column with real rows behind it that currently has
     * nowhere to go, and each list is asserted by name so no future change can
     * shrink one silently.
     */

    // (a) BLOCKED with measured data: the genuine "NoraMedi has no field"
    //     engineering gaps. R9 believed this list was empty; it was empty only
    //     because 10 of these columns had never been profiled.
    assert.deepEqual(report.blockedMeaningfulFields, [
      'ALTDOSYANO',
      'ANNEADI',
      'BABAADI',
      'FAX',
      'MEDENIHALI',
      'SIGORTATURU',
      'SUBEDOSYANO',
      'TURIZM',
      'UCRETTARIFESI',
      'UNVANI',
    ]);
    assert.equal(report.blockedMeaningful, 10);

    // (b) Nothing is legally blocked with data, and nothing is unaccounted.
    //     KVKKONAYKODU and KVKKSMS are both measured at 0 filled rows, so the
    //     consent-fabrication gate holds without costing the customer a row.
    assert.deepEqual(report.legalBlockedMeaningfulFields, []);
    assert.deepEqual(report.unaccountedMeaningfulFields, []);

    // (c) System-recommended exclusions nobody has confirmed. 17, not 5.
    assert.deepEqual(report.unconfirmedExclusionFields, [
      'AILEGURUBU',
      'CHECKBOX',
      'DOSYAVAR',
      'HATIRLAT',
      'KAYDEDEN',
      'KAYITSAATI',
      'KAYITTARIHI',
      'MESAJOK',
      'ODEMENOTU',
      'ODEMESONTARIHI',
      'RISK_TUTARI',
      'SONISLEMTARIHI',
      'SONODEMETARIHI',
      'SONRANDEVUTARIHI',
      'SUBE_ID',
      'TEDAVIDURUMU',
      'UST_HESAP_KODU',
    ]);
    assert.equal(report.systemRecommendedButUnconfirmedExclusions, 17);

    // (d) Open human questions. EK_ACIKLAMA joins the four R9 named, now that
    //     it is measured at 1 filled row rather than UNKNOWN.
    assert.equal(report.manualReview, 5, 'EVTELEFONU, ISTELEFONU, ILCE, KVKKILKKODU, EK_ACIKLAMA');
    assert.equal(report.sensitiveReview, 3, 'ONEMLINOT, KONTROLNOTU, KANGURUBU');

    // (e) And 14 columns already resolve to a real destination.
    assert.equal(report.resolved, 14);
  });

  await test('#6d: confirming every remaining exclusion is what makes the equation close', () => {
    // Same 91 columns, but modelling the state the program must actually reach:
    // every unmeasured column re-profiled, every review answered, every
    // remaining exclusion confirmed by a named admin.
    const rows: DataLossGateRecord[] = FIRST_CUSTOMER_MATRIX.map((e, i) => {
      const fill = measuredFillFor(e.sourceField)!;
      // Re-profiled: an unmeasured column is given a measured count.
      const filledCount = fill.filledCount ?? 1;
      const isWriting = e.mappingState === 'AUTO_CONFIDENT' || e.mappingState === 'RESOLVED';
      return {
        sourceField: e.sourceField,
        state: isWriting ? e.mappingState : 'IGNORE',
        destinationField: isWriting ? e.destinationField : null,
        sourceProfile: profile(filledCount, i, e.sourceField),
        isAutoSuggested: isWriting ? true : false,
        decidedByPlatformAdminId: isWriting ? null : OPERATOR_ID,
        decidedAt: isWriting ? null : new Date('2026-08-20T09:00:00.000Z'),
      };
    });

    const report = evaluateDataLossGate(rows);
    assert.equal(report.unmeasuredFillColumns, 0);
    assert.equal(report.systemRecommendedButUnconfirmedExclusions, 0);
    assert.equal(report.blockedMeaningful, 0);
    assert.equal(report.legalBlockedMeaningful, 0);
    assert.equal(report.unaccountedMeaningful, 0);
    assert.equal(report.balanced, true);
    assert.equal(report.satisfied, true, 'and only then is the run eligible to execute');
    assert.equal(
      report.meaningfulSourceColumns,
      report.resolved + report.operatorConfirmedExcluded,
      'with nothing left in review, the equation reduces to mapped + deliberately excluded',
    );
  });

  // ========================================================================
  section('R9-5. STRUCTURAL SAFETY OF THE GATE ITSELF');
  // ========================================================================

  await test('#7: every MAPPING_STATE resolves to a disposition; none falls through silently', () => {
    for (const state of MAPPING_STATES) {
      const column = classifyColumn(systemProposed({ state, destinationField: 'patient.firstName' }));
      assert.notEqual(column.disposition, undefined, state);
      // A state this gate does not understand must BLOCK, never pass.
      if (column.disposition === 'UNACCOUNTED') {
        assert.equal(column.blocksExecute, true, state);
      }
    }
    // An invented state is the case that matters: fail-closed, not fail-open.
    const rogue = classifyColumn(systemProposed({ state: 'SOMETHING_NEW' }));
    assert.equal(rogue.disposition, 'UNACCOUNTED');
    assert.equal(rogue.blocksExecute, true);
  });

  await test('#7b: a writing state with no destination is a hole, not a resolution', () => {
    const column = classifyColumn(
      systemProposed({ state: 'AUTO_CONFIDENT', destinationField: null, sourceProfile: profile(100) }),
    );
    assert.equal(column.disposition, 'UNACCOUNTED');
    assert.equal(column.blocksExecute, true);
  });

  await test('#8: the gate report carries counts and column names ONLY — never a cell value', () => {
    /*
     * The report is persisted on MigrationRun.dryRunSummary, returned over the
     * wire and summarised into the audit log, so its shape is a privacy
     * boundary. Everything in it must be a number, a boolean, or a vendor
     * COLUMN HEADER — the mapping screen shows those already. A sample value,
     * a distinct-value list or a row id would each be a leak.
     *
     * Asserted structurally rather than by eye, so a field added later is
     * caught by this test instead of by an incident.
     */
    const report = evaluateDataLossGate([
      systemProposed({ sourceField: 'ONEMLINOT', state: 'LEGAL_BLOCKED', sourceProfile: profile(6_805) }),
      systemProposed({ sourceField: 'UNVANI', state: 'BLOCKED', sourceProfile: null }),
      operatorDecided({ sourceField: 'HESAP_KODU', sourceProfile: profile(12) }),
    ]);

    const knownFieldLists = new Set([
      'unconfirmedExclusionFields',
      'blockedMeaningfulFields',
      'legalBlockedMeaningfulFields',
      'unmeasuredFillFields',
      'unaccountedMeaningfulFields',
    ]);
    const matrixFields = new Set(FIRST_CUSTOMER_MATRIX.map((e) => e.sourceField));

    for (const [key, value] of Object.entries(report)) {
      if (typeof value === 'number' || typeof value === 'boolean') continue;
      assert.ok(knownFieldLists.has(key), `unexpected non-scalar field "${key}" on the gate report`);
      assert.ok(Array.isArray(value), key);
      for (const entry of value as unknown[]) {
        assert.equal(typeof entry, 'string', key);
        assert.ok(
          matrixFields.has(entry as string),
          `"${entry}" is not a known source COLUMN NAME — the report must never carry data`,
        );
      }
    }

    // Sorted, so two runs over the same mapping produce byte-identical
    // evidence and an auditor can diff them.
    for (const key of knownFieldLists) {
      const list = (report as unknown as Record<string, string[]>)[key]!;
      assert.deepEqual(list, [...list].sort(), `${key} must be deterministic`);
    }
  });

  await test('#8b: the gate never reads a cell value — it depends only on counts and decision metadata', () => {
    // A profile stuffed with extra content changes nothing about the verdict:
    // the gate reads `filledCount` and the three decision fields, full stop.
    const withExtras = operatorDecided({
      sourceProfile: { ...profile(5), samples: ['must-never-be-read'], values: ['nor-this'] } as unknown,
    });
    const plain = operatorDecided({ sourceProfile: profile(5) });
    assert.deepEqual(classifyColumn(withExtras), { ...classifyColumn(plain), sourceField: withExtras.sourceField });
  });

  await test('#9: the fill-evidence classifier agrees with the gate on every boundary', () => {
    // One definition of "meaningful", used by the evidence module and the gate.
    assert.equal(fillEvidenceClassOf(null), 'UNMEASURED');
    assert.equal(fillEvidenceClassOf(undefined), 'UNMEASURED');
    assert.equal(fillEvidenceClassOf(0), 'ZERO_DATA');
    assert.equal(fillEvidenceClassOf(1), 'MEANINGFUL');
    assert.equal(fillEvidenceClassOf(14_890), 'MEANINGFUL');

    for (const entry of FIRST_CUSTOMER_MEASURED_FILL) {
      const expected = fillEvidenceClassOf(entry.filledCount);
      const column = classifyColumn(
        systemProposed({
          sourceField: entry.sourceField,
          state: 'IGNORE',
          sourceProfile: entry.filledCount === null ? null : profile(entry.filledCount),
        }),
      );
      const actual =
        column.disposition === 'UNMEASURED_FILL'
          ? 'UNMEASURED'
          : column.disposition === 'ZERO_DATA'
            ? 'ZERO_DATA'
            : 'MEANINGFUL';
      assert.equal(actual, expected, entry.sourceField);
    }
  });

  await test('#9b: every destination named by the matrix still exists (no dangling reclassification)', () => {
    // R9 changed four dispositions. This guards the class of mistake that
    // change could introduce: a state moved without its destination following.
    for (const e of FIRST_CUSTOMER_MATRIX) {
      if (e.destinationField === null) continue;
      assert.ok(getDestinationField(e.destinationField), `${e.sourceField} -> ${e.destinationField}`);
    }
    // MANUAL_REQUIRED must never carry a destination — an unanswered question
    // with an answer attached is not an unanswered question.
    for (const e of FIRST_CUSTOMER_MATRIX) {
      if (e.mappingState !== 'MANUAL_REQUIRED') continue;
      assert.equal(e.destinationField, null, `${e.sourceField} is under review but already has a destination`);
    }
  });

  // ------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
