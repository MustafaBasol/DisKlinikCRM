/**
 * firstCustomerMeasuredFill.ts — F3-DATA-MIG-TODAY-001-R9-DATA-LOSS-GATE
 *
 * THE MEASURED FILL EVIDENCE for the first customer's legacy dental export —
 * how many rows of each of the 91 named source columns actually carry a value.
 *
 * WHY THIS FILE EXISTS. R7/R8's data-loss gate proved its accounting against a
 * SYNTHETIC stand-in: every column was given `filledCount = 1`, which made all
 * 87 non-zero-data columns look "meaningful" and, worse, made the 4 hand-listed
 * zero-data columns look like the ONLY empty ones. Both halves were fiction.
 * A gate that decides whether real clinic data may be dropped may not be proved
 * against invented fill counts, so this module carries the real ones.
 *
 * SOURCE OF TRUTH: docs/program/PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md
 * §5 "Source→NoraMedi field matrix", column `FILL`, as measured by the R3
 * targeted re-profiling (§19 "R3 targeted re-profiling record") — the one pass
 * that actually opened the workbook (14,890 data rows) with a scratchpad-only
 * reader that computed aggregate counts. Each row's `evidence` string is the
 * §5 FILL cell verbatim, so a reviewer can diff this table against the document
 * without trusting a transcription.
 *
 * PRIVACY. COUNTS ONLY. This module never holds a cell value, a sample, a
 * distinct-value list or any per-patient fact — exactly the contract
 * `SourceColumnProfile` states ("safe: counts only, never sample values").
 * The real workbook is not in this repository and must never be.
 *
 * ---------------------------------------------------------------------------
 * THE FINDING THIS TABLE MAKES UNAVOIDABLE
 * ---------------------------------------------------------------------------
 * Of the 91 named columns, the accepted profile measures:
 *
 *     23  MEANINGFUL   at least one non-empty value, count known
 *     10  ZERO_DATA    measured, 0 / 14,890 filled
 *     58  UNMEASURED   never profiled — fill is genuinely unknown
 *
 * 58 is not a rounding detail, it is the headline. R3's own record says so:
 * "the full 91-column matrix is NOT YET FULLY FROZEN — EK_ACIKLAMA/CHECKBOX and
 * roughly 25 other UNKNOWN-fill columns remain unmeasured". The true figure is
 * 58, and the consequence is that for 58 of 91 columns NOBODY CAN CURRENTLY SAY
 * whether excluding them loses clinic data.
 *
 * `filledCount: null` therefore means UNMEASURED and must never be read as 0.
 * dataLossGate.ts treats it as fail-closed: a column whose fill was never
 * measured cannot be proved safe to drop, so it blocks Execute rather than
 * being quietly swept in with the genuinely empty ones.
 *
 * THIS TABLE IS EVIDENCE, NOT THE RUNTIME INPUT. A real migration run profiles
 * the uploaded workbook itself and persists the result on
 * `MigrationFieldMapping.sourceProfile`; the gate reads THAT. This module is
 * how the gate's behaviour is proved against the accepted first-customer
 * evidence in a test, and how a reviewer sees the same numbers the gate will.
 */

/** How the fill figure in this table was established. */
export type FillMeasurement =
  /** §5 states an explicit non-empty row count. */
  | 'EXACT'
  /** §5 states only a percentage; the count is that percentage of 14,890. */
  | 'PERCENTAGE_DERIVED'
  /** §5 states an approximate row count ("≈13 rows"). */
  | 'APPROX_ROW_COUNT'
  /** §5 records UNKNOWN / UNMEASURED. The fill is not known at all. */
  | 'UNMEASURED';

export interface MeasuredColumnFill {
  /** Byte-exact vendor column name — the same key firstCustomerMatrix.ts uses. */
  sourceField: string;
  /**
   * Rows carrying a non-empty value, or `null` when the column was NEVER
   * MEASURED. `null` is not zero and must never be coerced to zero.
   */
  filledCount: number | null;
  measurement: FillMeasurement;
  /** The §5 `FILL` cell verbatim, so the transcription is auditable. */
  evidence: string;
}

/** Data rows in the first customer's export (header row excluded). */
export const FIRST_CUSTOMER_TOTAL_ROWS = 14_890;

export const FIRST_CUSTOMER_MEASURED_FILL: readonly MeasuredColumnFill[] = [
  { sourceField: 'HASTA_ID',              filledCount: 14890, measurement: 'EXACT',               evidence: "100 % / 14,890 uniq" },
  { sourceField: 'ADI',                   filledCount: 14890, measurement: 'PERCENTAGE_DERIVED',  evidence: "100 %" },
  { sourceField: 'SOYADI',                filledCount: 14890, measurement: 'PERCENTAGE_DERIVED',  evidence: "100 %" },
  { sourceField: 'UNVANI',                filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'BABAADI',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ANNEADI',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'CINSIYET',              filledCount: 11807, measurement: 'EXACT',               evidence: "79.3 % / 2 distinct" },
  { sourceField: 'DOGUMTARIHI',           filledCount: 10349, measurement: 'PERCENTAGE_DERIVED',  evidence: "69.5 %" },
  { sourceField: 'DOGUMIL',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'DOGUMILCE',             filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'MEDENIHALI',            filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'MESLEGI',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'EGITIMDURUMU',          filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'UYRUK',                 filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'ULKE',                  filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'TCNO',                  filledCount: 11500, measurement: 'EXACT',               evidence: "77.2 % / 11,500" },
  { sourceField: 'PASAPORTNO',            filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'SOSYAL_GUVENCE_NO',     filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'SOSYAL_GUVENCE_KURUMU', filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ENABIZTAKIPNO',         filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'YUPASS_NO',             filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'HTS_KODU',              filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'VERGIDAIRESI',          filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'VERGINO',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'EVTELEFONU',            filledCount:    45, measurement: 'PERCENTAGE_DERIVED',  evidence: "0.3 %" },
  { sourceField: 'ISTELEFONU',            filledCount:   164, measurement: 'PERCENTAGE_DERIVED',  evidence: "1.1 %" },
  { sourceField: 'CEPTELEFONU',           filledCount: 13609, measurement: 'PERCENTAGE_DERIVED',  evidence: "91.4 %" },
  { sourceField: 'FAX',                   filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'EMAIL',                 filledCount:     7, measurement: 'EXACT',               evidence: "0.05 % (7 rows, 1 valid)" },
  { sourceField: 'ADRESI',                filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ADRES_KODU',            filledCount:     0, measurement: 'EXACT',               evidence: "0.00 % (0/14,890) — R3" },
  { sourceField: 'IL',                    filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ILCE',                  filledCount:    13, measurement: 'APPROX_ROW_COUNT',    evidence: "≈13 rows" },
  { sourceField: 'MAHALLE',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KANGURUBU',             filledCount:     1, measurement: 'EXACT',               evidence: "1 row" },
  { sourceField: 'ONEMLINOT',             filledCount:  6805, measurement: 'EXACT',               evidence: "45.70 % (6,805/14,890) — R3" },
  { sourceField: 'UZUNNOT',               filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'KONTROLNOTU',           filledCount:     2, measurement: 'EXACT',               evidence: "0.01 % (2/14,890) — R3" },
  { sourceField: 'TEDAVIDURUMU',          filledCount:     3, measurement: 'EXACT',               evidence: "0.02 % (3 rows)" },
  { sourceField: 'SUBE_ID',               filledCount:  9083, measurement: 'PERCENTAGE_DERIVED',  evidence: "61 % / 1 distinct" },
  { sourceField: 'HASTADOKTOR',           filledCount: 14816, measurement: 'PERCENTAGE_DERIVED',  evidence: "99.5 % / 25 distinct" },
  { sourceField: 'REFERANSI',             filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KURUMREFERANSI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'REHBER_ID',             filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'CALISMAGURUBU',         filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'AILEGURUBU',            filledCount: 14890, measurement: 'EXACT',               evidence: "100.00 % (14,890/14,890) — R3" },
  { sourceField: 'UCRETTARIFESI',         filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KURUMTARIFE',           filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SIGORTATURU',           filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'RISK_TUTARI',           filledCount:     2, measurement: 'EXACT',               evidence: "0.01 % (2 rows)" },
  { sourceField: 'INDIRIMORANI',          filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'CARIODEMESTATU',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ODEMESONTARIHI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SONODEMETARIHI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ODEMENOTU',             filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ODEMENOTTARIHI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SMSBORCTARIH',          filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SMSODEMETARIHI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SONISLEMTARIHI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SONKONTROLTARIHI',      filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'TEDAVISONTARIHI',       filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'TEDAVIBITISTARIH',      filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SONRANDEVUTARIHI',      filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SONANKETTARIHI',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SONGORUNTUTARIHI',      filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KONTROLPERYODU',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'HATIRLAT',              filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KVKKONAYKODU',          filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'KVKKILKKODU',           filledCount:  4750, measurement: 'PERCENTAGE_DERIVED',  evidence: "31.9 % / 4,633 distinct" },
  { sourceField: 'KVKKSMS',               filledCount:     0, measurement: 'EXACT',               evidence: "0 %" },
  { sourceField: 'MESAJOK',               filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SMSGONDERILDI',         filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KAYITTARIHI',           filledCount: 14890, measurement: 'PERCENTAGE_DERIVED',  evidence: "100 % (2016→2026)" },
  { sourceField: 'KAYITSAATI',            filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'KAYDEDEN',              filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'SILINDI',               filledCount: 14890, measurement: 'PERCENTAGE_DERIVED',  evidence: "100 % / 172 true" },
  { sourceField: 'DOSYAVAR',              filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'CHECKBOX',              filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'HESAP_KODU',            filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'UST_HESAP_KODU',        filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'DOSYANO',               filledCount: 14718, measurement: 'EXACT',               evidence: "98.84 % (14,718/14,890) — R3" },
  { sourceField: 'SUBEDOSYANO',           filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ALTDOSYANO',            filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'ULKEGIRISTARIHI',       filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNMEASURED" },
  { sourceField: 'ULKECIKISTARIHI',       filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNMEASURED" },
  { sourceField: 'GELDIGIULKE',           filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNMEASURED" },
  { sourceField: 'TURIZM',                filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNMEASURED" },
  { sourceField: 'RESIMUZANTI',           filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'HASTARENGI',            filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'EK_ACIKLAMA',           filledCount:  null, measurement: 'UNMEASURED',          evidence: "UNKNOWN" },
  { sourceField: 'YAKINLIKKODU',          filledCount:     0, measurement: 'EXACT',               evidence: "0.00 % (0/14,890) — R3" },];

const FILL_BY_FIELD = new Map(FIRST_CUSTOMER_MEASURED_FILL.map((f) => [f.sourceField, f]));

export function measuredFillFor(sourceField: string): MeasuredColumnFill | undefined {
  return FILL_BY_FIELD.get(sourceField);
}

/** Which accounting bucket a measured fill puts a column in. */
export type FillEvidenceClass = 'MEANINGFUL' | 'ZERO_DATA' | 'UNMEASURED';

export function fillEvidenceClassOf(filledCount: number | null | undefined): FillEvidenceClass {
  if (filledCount === null || filledCount === undefined) return 'UNMEASURED';
  if (!Number.isFinite(filledCount) || filledCount < 0) return 'UNMEASURED';
  return filledCount > 0 ? 'MEANINGFUL' : 'ZERO_DATA';
}

/** Counts by evidence class. Used by the gate test and by the delivery report. */
export function measuredFillCounts(): Record<FillEvidenceClass, number> {
  const counts: Record<FillEvidenceClass, number> = { MEANINGFUL: 0, ZERO_DATA: 0, UNMEASURED: 0 };
  for (const entry of FIRST_CUSTOMER_MEASURED_FILL) {
    counts[fillEvidenceClassOf(entry.filledCount)]++;
  }
  return counts;
}
