/**
 * firstCustomerMeasuredFill.ts — F3-DATA-MIG-TODAY-001-R10-FINAL-COVERAGE
 *
 * THE MEASURED FILL EVIDENCE for the first customer's legacy dental export.
 * Every one of the 91 named source columns is MEASURED. No UNKNOWN remains.
 *
 * ---------------------------------------------------------------------------
 * WHAT R10 CHANGED, AND WHY THE PREVIOUS TABLE COULD NOT BE TRUSTED
 * ---------------------------------------------------------------------------
 * R9 built this table by TRANSCRIBING the FILL column of
 * PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md §5 by hand. That was the
 * best evidence available then, but it had two defects only a real
 * measurement could expose:
 *
 *   1. 58 of 91 columns were recorded UNMEASURED ("UNKNOWN"), because §5
 *      genuinely never profiled them. The gate correctly fail-closed on all
 *      58 — which is precisely why the first customer could not reach Execute.
 *
 *   2. Several of the 33 columns that WERE recorded carried WRONG NUMBERS.
 *      Transcription drift is not hypothetical here; it happened. The worst
 *      case was ULKE, recorded "0 %" when the column is in fact 100.00 %
 *      filled (14,890/14,890). A gate deciding whether clinic data may be
 *      dropped was reading a figure off by 14,890 rows. Others that moved:
 *      CINSIYET 11,807 -> 11,814 · DOGUMTARIHI 10,349 -> 10,342 ·
 *      EVTELEFONU 45 -> 50 · ISTELEFONU 164 -> 166 ·
 *      CEPTELEFONU 13,609 -> 13,613 · HASTADOKTOR 14,816 -> 14,814 ·
 *      KVKKILKKODU 4,750 -> 4,754.
 *
 * R10 therefore transcribes nothing. Every number below was produced by
 * running THE REPOSITORY'S OWN ANALYZE CODE — parseSourceWorkbook() then
 * profileColumns() from parser/canonicalParser.ts — over the accepted
 * first-customer workbook, and emitted mechanically. These are
 * byte-identical to what a real Analyze pass writes into
 * MigrationFieldMapping.sourceProfile, because they came from that function.
 *
 * SOURCE OF TRUTH — the workbook itself, identified by content:
 *   file      hastalar tüm liste.xls
 *   sha256    f08c001991b5e2b6647d2a1b3b51156dce82511edaa900843bb01e4384da5612
 *   size      11,291,648 bytes (OLE2/BIFF8)
 *   sheet     "Sayfa1" (single visible sheet), 1900 date epoch
 *   shape     14,891 x 92 physical -> 91 named columns x 14,890 data rows
 *             (physical column 0 is the structurally-empty leading column,
 *             dropped by the canonical parser exactly as documented)
 *
 * The workbook is NOT in this repository and must never be. Reproduce it via
 * the analyze route, or offline against the same sha256.
 *
 * PRIVACY. COUNTS AND LENGTHS ONLY — the same contract profileColumns()
 * itself keeps ("no sample value, no most-frequent value and no min/max
 * value"). This module holds no cell value, no distinct-value list and no
 * per-patient fact.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE MEASUREMENT SHOWS
 * ---------------------------------------------------------------------------
 *     49  MEANINGFUL   at least one non-empty value
 *          of which 10 are CONSTANT (see below)
 *     42  ZERO_DATA    measured, 0 / 14,890 filled
 *      0  UNMEASURED   none remain
 *
 * ---------------------------------------------------------------------------
 * CONSTANT COLUMNS — A DISTINCTION THE OLD TABLE COULD NOT MAKE
 * ---------------------------------------------------------------------------
 * informationContent records whether a filled column actually DISCRIMINATES
 * between patients. 10 columns are filled but carry exactly ONE distinct
 * value across every filled row, so importing them would add a constant to
 * up to 14,890 patient records and distinguish none of them:
 *
 *     UST_HESAP_KODU  13,985 rows, all "120.01"   (one ledger account code)
 *     SUBE_ID          9,083 rows, all "none"     (literally the string "none")
 *     CHECKBOX         3,500 rows, all "Yeni"
 *     DOSYAVAR         3,051 rows, all "false"
 *     KAYDEDEN        14,890 rows, all "admin"
 *     KANGURUBU            1 row,  "Bilinmiyor"   (= "Unknown" — so this
 *                                                  export carries NO blood
 *                                                  group data at all)
 *     RISK_TUTARI          2 rows, all "0"        (no outstanding balance)
 *     UCRETTARIFESI 1 row · EK_ACIKLAMA 1 row · ODEMESONTARIHI 1 row
 *
 * CONSTANT is NOT a licence to drop a column silently. It is evidence an
 * operator can act on: the difference between "this column would have told
 * us something and we are discarding it" and "this column tells us nothing
 * about any individual patient". The data-loss gate still counts a CONSTANT
 * column as MEANINGFUL and still demands an explicit decision —
 * fillEvidenceClassOf() is deliberately unchanged.
 *
 * THIS TABLE IS EVIDENCE, NOT THE RUNTIME INPUT. A real run profiles the
 * uploaded workbook itself and the gate reads THAT. This module is how the
 * gate's behaviour is proved against the accepted first-customer evidence in
 * a test, and how a reviewer sees the same numbers the gate will.
 */

/** How the fill figure in this table was established. */
export type FillMeasurement =
  /**
   * Produced by running parseSourceWorkbook() + profileColumns() over the
   * accepted workbook (sha256 f08c0019…). The only value R10 emits: every
   * column was measured the same way, by the same code a real run uses.
   */
  | 'ANALYZE_MEASURED'
  /**
   * Retained so the type still models an entry whose fill is genuinely
   * unknown. No entry below uses it, and filledCount: null remains the
   * fail-closed signal the gate blocks on.
   */
  | 'UNMEASURED';

/**
 * Whether a filled column actually discriminates between patients.
 * Derived from distinctCount, never guessed.
 */
export type InformationContent =
  /** 0 filled rows. */
  | 'NO_DATA'
  /** Filled, but exactly one distinct value across every filled row. */
  | 'CONSTANT'
  /** Filled with two or more distinct values. */
  | 'VARYING';

export interface MeasuredColumnFill {
  /** Byte-exact vendor column name — the same key firstCustomerMatrix.ts uses. */
  sourceField: string;
  /** Physical 0-based column index in the workbook, as the parser reports it. */
  sourceIndex: number;
  /**
   * Rows carrying a non-empty value, or null when the column was NEVER
   * MEASURED. null is not zero and must never be coerced to zero. Every R10
   * entry is a real number.
   */
  filledCount: number | null;
  /** Distinct non-empty values. A COUNT — never the values themselves. */
  distinctCount: number;
  /** Longest observed text length. A length, not a value. */
  maxLength: number;
  informationContent: InformationContent;
  measurement: FillMeasurement;
  /** Human-readable restatement of the same counts, for reviewers. */
  evidence: string;
}

/** Data rows in the first customer's export (header row excluded). */
export const FIRST_CUSTOMER_TOTAL_ROWS = 14_890;

/**
 * SHA-256 of the accepted first-customer workbook every number below was
 * measured from. Recorded so a reviewer can prove the table and the file
 * agree without the file ever entering the repository.
 */
export const FIRST_CUSTOMER_WORKBOOK_SHA256 =
  'f08c001991b5e2b6647d2a1b3b51156dce82511edaa900843bb01e4384da5612';

/** Named source columns after the structurally-empty leading column is dropped. */
export const FIRST_CUSTOMER_NAMED_COLUMNS = 91;

export const FIRST_CUSTOMER_MEASURED_FILL: readonly MeasuredColumnFill[] = [
  { sourceField: 'HASTA_ID',              sourceIndex:  1, filledCount: 14890, distinctCount: 14890, maxLength:  24, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 14,890 distinct" },
  { sourceField: 'HESAP_KODU',            sourceIndex:  2, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'UST_HESAP_KODU',        sourceIndex:  3, filledCount: 13985, distinctCount:     1, maxLength:   6, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "13,985/14,890 (93.92 %), 1 distinct" },
  { sourceField: 'SUBE_ID',               sourceIndex:  4, filledCount:  9083, distinctCount:     1, maxLength:   4, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "9,083/14,890 (61.00 %), 1 distinct" },
  { sourceField: 'UYRUK',                 sourceIndex:  5, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'ULKE',                  sourceIndex:  6, filledCount: 14890, distinctCount:     3, maxLength:   3, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 3 distinct" },
  { sourceField: 'TCNO',                  sourceIndex:  7, filledCount: 11500, distinctCount: 11470, maxLength:  20, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "11,500/14,890 (77.23 %), 11,470 distinct" },
  { sourceField: 'PASAPORTNO',            sourceIndex:  8, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SOSYAL_GUVENCE_NO',     sourceIndex:  9, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SOSYAL_GUVENCE_KURUMU', sourceIndex: 10, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'YAKINLIKKODU',          sourceIndex: 11, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'DOSYANO',               sourceIndex: 12, filledCount: 14718, distinctCount: 14701, maxLength:   8, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,718/14,890 (98.84 %), 14,701 distinct" },
  { sourceField: 'SUBEDOSYANO',           sourceIndex: 13, filledCount:  9105, distinctCount:  9085, maxLength:   4, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "9,105/14,890 (61.15 %), 9,085 distinct" },
  { sourceField: 'ADI',                   sourceIndex: 14, filledCount: 14890, distinctCount:  3341, maxLength:  25, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 3,341 distinct" },
  { sourceField: 'SOYADI',                sourceIndex: 15, filledCount: 14890, distinctCount:  3513, maxLength:  24, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 3,513 distinct" },
  { sourceField: 'RESIMUZANTI',           sourceIndex: 16, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'UNVANI',                sourceIndex: 17, filledCount: 14890, distinctCount: 12806, maxLength:  35, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 12,806 distinct" },
  { sourceField: 'CINSIYET',              sourceIndex: 18, filledCount: 11814, distinctCount:     2, maxLength:   5, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "11,814/14,890 (79.34 %), 2 distinct" },
  { sourceField: 'KANGURUBU',             sourceIndex: 19, filledCount:     1, distinctCount:     1, maxLength:  10, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "1/14,890 (0.01 %), 1 distinct" },
  { sourceField: 'BABAADI',               sourceIndex: 20, filledCount:    18, distinctCount:    18, maxLength:  28, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "18/14,890 (0.12 %), 18 distinct" },
  { sourceField: 'ANNEADI',               sourceIndex: 21, filledCount:    25, distinctCount:    25, maxLength:  19, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "25/14,890 (0.17 %), 25 distinct" },
  { sourceField: 'DOGUMIL',               sourceIndex: 22, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'DOGUMILCE',             sourceIndex: 23, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'DOGUMTARIHI',           sourceIndex: 24, filledCount: 10342, distinctCount:  6988, maxLength:  10, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "10,342/14,890 (69.46 %), 6,988 distinct" },
  { sourceField: 'MEDENIHALI',            sourceIndex: 25, filledCount:    57, distinctCount:     2, maxLength:   5, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "57/14,890 (0.38 %), 2 distinct" },
  { sourceField: 'MESLEGI',               sourceIndex: 26, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'EVTELEFONU',            sourceIndex: 27, filledCount:    50, distinctCount:    50, maxLength:  15, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "50/14,890 (0.34 %), 50 distinct" },
  { sourceField: 'ISTELEFONU',            sourceIndex: 28, filledCount:   166, distinctCount:   166, maxLength:  16, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "166/14,890 (1.11 %), 166 distinct" },
  { sourceField: 'CEPTELEFONU',           sourceIndex: 29, filledCount: 13613, distinctCount: 11658, maxLength:  16, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "13,613/14,890 (91.42 %), 11,658 distinct" },
  { sourceField: 'FAX',                   sourceIndex: 30, filledCount:    96, distinctCount:    94, maxLength:  16, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "96/14,890 (0.64 %), 94 distinct" },
  { sourceField: 'EMAIL',                 sourceIndex: 31, filledCount:     7, distinctCount:     7, maxLength:  29, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "7/14,890 (0.05 %), 7 distinct" },
  { sourceField: 'ADRESI',                sourceIndex: 32, filledCount:  1456, distinctCount:  1270, maxLength:  84, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "1,456/14,890 (9.78 %), 1,270 distinct" },
  { sourceField: 'ADRES_KODU',            sourceIndex: 33, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'IL',                    sourceIndex: 34, filledCount:    14, distinctCount:     2, maxLength:   8, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14/14,890 (0.09 %), 2 distinct" },
  { sourceField: 'ILCE',                  sourceIndex: 35, filledCount:    13, distinctCount:     9, maxLength:   8, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "13/14,890 (0.09 %), 9 distinct" },
  { sourceField: 'MAHALLE',               sourceIndex: 36, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'REFERANSI',             sourceIndex: 37, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'KURUMREFERANSI',        sourceIndex: 38, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'INDIRIMORANI',          sourceIndex: 39, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'UCRETTARIFESI',         sourceIndex: 40, filledCount:     1, distinctCount:     1, maxLength:   1, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "1/14,890 (0.01 %), 1 distinct" },
  { sourceField: 'RISK_TUTARI',           sourceIndex: 41, filledCount:     2, distinctCount:     1, maxLength:   1, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "2/14,890 (0.01 %), 1 distinct" },
  { sourceField: 'EK_ACIKLAMA',           sourceIndex: 42, filledCount:     1, distinctCount:     1, maxLength:  15, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "1/14,890 (0.01 %), 1 distinct" },
  { sourceField: 'VERGIDAIRESI',          sourceIndex: 43, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'VERGINO',               sourceIndex: 44, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'HASTADOKTOR',           sourceIndex: 45, filledCount: 14814, distinctCount:    25, maxLength:  24, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,814/14,890 (99.49 %), 25 distinct" },
  { sourceField: 'ONEMLINOT',             sourceIndex: 46, filledCount:  6805, distinctCount:  6036, maxLength: 484, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "6,805/14,890 (45.70 %), 6,036 distinct" },
  { sourceField: 'UZUNNOT',               sourceIndex: 47, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'HATIRLAT',              sourceIndex: 48, filledCount: 14890, distinctCount:     2, maxLength:   5, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 2 distinct" },
  { sourceField: 'CALISMAGURUBU',         sourceIndex: 49, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'AILEGURUBU',            sourceIndex: 50, filledCount: 14890, distinctCount: 14890, maxLength:  24, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 14,890 distinct" },
  { sourceField: 'HASTARENGI',            sourceIndex: 51, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'TEDAVIDURUMU',          sourceIndex: 52, filledCount:     3, distinctCount:     3, maxLength:   1, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "3/14,890 (0.02 %), 3 distinct" },
  { sourceField: 'KONTROLPERYODU',        sourceIndex: 53, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SONISLEMTARIHI',        sourceIndex: 54, filledCount:   331, distinctCount:    60, maxLength:  10, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "331/14,890 (2.22 %), 60 distinct" },
  { sourceField: 'MESAJOK',               sourceIndex: 55, filledCount: 14153, distinctCount:     2, maxLength:   5, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,153/14,890 (95.05 %), 2 distinct" },
  { sourceField: 'SONKONTROLTARIHI',      sourceIndex: 56, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'TEDAVISONTARIHI',       sourceIndex: 57, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'ODEMESONTARIHI',        sourceIndex: 58, filledCount:     1, distinctCount:     1, maxLength:  10, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "1/14,890 (0.01 %), 1 distinct" },
  { sourceField: 'SONODEMETARIHI',        sourceIndex: 59, filledCount:   202, distinctCount:    13, maxLength:  10, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "202/14,890 (1.36 %), 13 distinct" },
  { sourceField: 'KONTROLNOTU',           sourceIndex: 60, filledCount:     2, distinctCount:     2, maxLength:  17, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "2/14,890 (0.01 %), 2 distinct" },
  { sourceField: 'SONRANDEVUTARIHI',      sourceIndex: 61, filledCount: 13403, distinctCount:   766, maxLength:  10, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "13,403/14,890 (90.01 %), 766 distinct" },
  { sourceField: 'ODEMENOTU',             sourceIndex: 62, filledCount:     3, distinctCount:     3, maxLength:  14, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "3/14,890 (0.02 %), 3 distinct" },
  { sourceField: 'CARIODEMESTATU',        sourceIndex: 63, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'ODEMENOTTARIHI',        sourceIndex: 64, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'KAYITTARIHI',           sourceIndex: 65, filledCount: 14890, distinctCount:  1825, maxLength:  10, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 1,825 distinct" },
  { sourceField: 'KAYITSAATI',            sourceIndex: 66, filledCount: 14890, distinctCount: 11711, maxLength:  19, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 11,711 distinct" },
  { sourceField: 'CHECKBOX',              sourceIndex: 67, filledCount:  3500, distinctCount:     1, maxLength:   4, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "3,500/14,890 (23.51 %), 1 distinct" },
  { sourceField: 'KAYDEDEN',              sourceIndex: 68, filledCount: 14890, distinctCount:     1, maxLength:   5, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 1 distinct" },
  { sourceField: 'SILINDI',               sourceIndex: 69, filledCount: 14890, distinctCount:     2, maxLength:   5, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "14,890/14,890 (100.00 %), 2 distinct" },
  { sourceField: 'KURUMTARIFE',           sourceIndex: 70, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'REHBER_ID',             sourceIndex: 71, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'KVKKONAYKODU',          sourceIndex: 72, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'KVKKILKKODU',           sourceIndex: 73, filledCount:  4754, distinctCount:  4633, maxLength:   5, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "4,754/14,890 (31.93 %), 4,633 distinct" },
  { sourceField: 'KVKKSMS',               sourceIndex: 74, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SMSBORCTARIH',          sourceIndex: 75, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SMSGONDERILDI',         sourceIndex: 76, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'TEDAVIBITISTARIH',      sourceIndex: 77, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SONANKETTARIHI',        sourceIndex: 78, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'DOSYAVAR',              sourceIndex: 79, filledCount:  3051, distinctCount:     1, maxLength:   5, informationContent: 'CONSTANT',  measurement: 'ANALYZE_MEASURED', evidence: "3,051/14,890 (20.49 %), 1 distinct" },
  { sourceField: 'SONGORUNTUTARIHI',      sourceIndex: 80, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'ENABIZTAKIPNO',         sourceIndex: 81, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'ULKEGIRISTARIHI',       sourceIndex: 82, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'ULKECIKISTARIHI',       sourceIndex: 83, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'HTS_KODU',              sourceIndex: 84, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SMSODEMETARIHI',        sourceIndex: 85, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'EGITIMDURUMU',          sourceIndex: 86, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'YUPASS_NO',             sourceIndex: 87, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'SIGORTATURU',           sourceIndex: 88, filledCount:     2, distinctCount:     2, maxLength:   9, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "2/14,890 (0.01 %), 2 distinct" },
  { sourceField: 'GELDIGIULKE',           sourceIndex: 89, filledCount:     0, distinctCount:     0, maxLength:   0, informationContent: 'NO_DATA',   measurement: 'ANALYZE_MEASURED', evidence: "0/14,890 (0.00 %)" },
  { sourceField: 'TURIZM',                sourceIndex: 90, filledCount:     6, distinctCount:     4, maxLength:   2, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "6/14,890 (0.04 %), 4 distinct" },
  { sourceField: 'ALTDOSYANO',            sourceIndex: 91, filledCount:    10, distinctCount:    10, maxLength:   4, informationContent: 'VARYING',   measurement: 'ANALYZE_MEASURED', evidence: "10/14,890 (0.07 %), 10 distinct" },
];

const FILL_BY_FIELD = new Map(FIRST_CUSTOMER_MEASURED_FILL.map((f) => [f.sourceField, f]));

export function measuredFillFor(sourceField: string): MeasuredColumnFill | undefined {
  return FILL_BY_FIELD.get(sourceField);
}

/** Which accounting bucket a measured fill puts a column in. */
export type FillEvidenceClass = 'MEANINGFUL' | 'ZERO_DATA' | 'UNMEASURED';

/**
 * UNCHANGED BY R10, DELIBERATELY. A CONSTANT column is still MEANINGFUL to
 * the data-loss gate: it has data, so discarding it still requires a
 * decision. informationContent informs that decision; it never makes it.
 */
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

/** Counts by information content. Reported alongside, never instead of, the above. */
export function informationContentCounts(): Record<InformationContent, number> {
  const counts: Record<InformationContent, number> = { NO_DATA: 0, CONSTANT: 0, VARYING: 0 };
  for (const entry of FIRST_CUSTOMER_MEASURED_FILL) counts[entry.informationContent]++;
  return counts;
}
