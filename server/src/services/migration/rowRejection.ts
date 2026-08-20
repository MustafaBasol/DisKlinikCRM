/**
 * rowRejection.ts — F3-DATA-MIG-TODAY-001-R12.
 *
 * ONE definition of "this source row cannot be imported", shared by the dry run
 * and by the downloadable rejected-row workbook.
 *
 * WHY IT IS SHARED RATHER THAN RE-DERIVED. The dry run tells the operator "1
 * row is invalid"; the export hands them the row to fix. If those two disagree
 * by even one row the operator is chasing a ghost — they correct a file that
 * still fails, or they never see the row that actually failed. Two
 * implementations of the same three rules WOULD drift, so there is one, here,
 * and dryRun.ts calls it in its own row loop.
 *
 * THE THREE REASONS A ROW IS REJECTED, in the order they are applied. The order
 * matters: a row is reported under its FIRST reason, because that is the one
 * the operator has to fix before any later one can even be evaluated.
 *
 *   1. BUILD FAILURES     the row builder could not produce a valid patient
 *                         draft (missing name, future birth date, unusable
 *                         phone, no source record id...). One finding per
 *                         failure, so a row with three problems downloads with
 *                         three lines and the operator fixes all three in one
 *                         pass instead of three re-imports.
 *   2. DUPLICATE SOURCE   the vendor record id appears on more than one row.
 *                         Both rows are held: collapsing them would merge two
 *                         patients on a guess.
 *   3. UNRESOLVED REFERENCE  the row's practitioner value was never mapped to a
 *                         NoraMedi user. This is fixed in Reference Mapping,
 *                         NOT in the workbook, and the guidance says so.
 *
 * ─── PRIVACY ──────────────────────────────────────────────────────────────
 * NOTHING in this module reads or emits a cell value. It classifies, names the
 * destination field and the vendor source column, and returns codes and
 * templated messages. The one place original values are read is the export
 * writer, which does it deliberately and under an explicit contract — see
 * rejectedRowReport.ts. Keeping the value out of THIS module is what makes it
 * safe for dryRun.ts, whose findings are persisted on the run and logged.
 */

import type { MigrationErrorCode } from './contracts.js';
import type { BuiltRow } from './rowBuilder.js';

/**
 * The stable, machine-readable reason a row was rejected.
 *
 * These are a PUBLIC CONTRACT: they appear in the downloadable workbook that a
 * clinic keeps, and support answers questions about them months later. They are
 * deliberately NOT the internal `MigrationErrorCode`s, which name the layer
 * that noticed the problem ("ROW_VALUE_INVALID") rather than the problem
 * ("INVALID_FUTURE_BIRTH_DATE"). Renaming one of these is a breaking change to
 * an artifact that has already left the building.
 */
export const ROW_REJECTION_CODES = [
  'INVALID_FUTURE_BIRTH_DATE',
  'INVALID_BIRTH_DATE',
  'INVALID_PHONE',
  'MISSING_REQUIRED_NAME',
  'MISSING_SOURCE_RECORD_ID',
  'INVALID_FIELD_VALUE',
  'DUPLICATE_OR_AMBIGUOUS_REFERENCE',
  'UNRESOLVED_PRACTITIONER_REFERENCE',
] as const;

export type RowRejectionCode = (typeof ROW_REJECTION_CODES)[number];

/** Why a row was held back, at the level an operator acts on. */
export type RowRejectionKind = 'INVALID' | 'DUPLICATE_SOURCE' | 'REFERENCE_UNRESOLVED';

export interface RowRejectionFinding {
  code: RowRejectionCode;
  /** The internal code the layer below reported. Kept for support/debugging. */
  internalCode: MigrationErrorCode;
  /** NoraMedi destination field, e.g. `patient.dateOfBirth`. Never a value. */
  fieldName: string | null;
  /** Turkish explanation for the operator. Templated; never a value. */
  messageTr: string;
  /** What to do about it, in Turkish. Deterministic per code. */
  guidanceTr: string;
  /** The English engineering message, verbatim from the layer that produced it. */
  internalMessage: string;
}

export interface RowRejection {
  rowNumber: number;
  sourceId: string | null;
  kind: RowRejectionKind;
  findings: RowRejectionFinding[];
}

/** Row-loop context that cannot be derived from a single row. */
export interface RowRejectionContext {
  /** How many times each provenance source id appears in the whole file. */
  sourceIdCounts: ReadonlyMap<string, number>;
  /** Practitioner source values with no approved reference map entry. */
  unresolvedReferenceValues: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Internal failure -> public rejection code
// ---------------------------------------------------------------------------

/**
 * The one place an internal failure becomes a public code, a Turkish sentence
 * and a correction instruction.
 *
 * Classification reads the FIELD first and the message only as a tiebreak. A
 * field name is structural — it comes from the destination catalog and cannot
 * drift — whereas the message is prose written for an engineer. The single
 * message test (`/future/`) is on a string that transforms.ts owns and that a
 * test in this task pins, so it cannot silently stop matching.
 */
function classifyFailure(
  code: MigrationErrorCode,
  fieldName: string | undefined,
  message: string,
): Pick<RowRejectionFinding, 'code' | 'messageTr' | 'guidanceTr'> {
  const field = fieldName ?? '';

  if (field === 'patient.dateOfBirth') {
    if (/future/i.test(message)) {
      return {
        code: 'INVALID_FUTURE_BIRTH_DATE',
        messageTr:
          'Doğum tarihi gelecekte bir tarih. Hasta kaydı gelecekteki bir doğum tarihiyle oluşturulamaz.',
        guidanceTr:
          'DOGUMTARIHI sütunundaki tarihi gerçek doğum tarihiyle düzeltin (GG.AA.YYYY). Tarih bilinmiyorsa hücreyi boş bırakın; hasta doğum tarihi olmadan da aktarılır.',
      };
    }
    return {
      code: 'INVALID_BIRTH_DATE',
      messageTr: 'Doğum tarihi okunamadı veya geçerli bir tarih değil.',
      guidanceTr:
        'DOGUMTARIHI sütununu GG.AA.YYYY biçiminde düzeltin. Tarih bilinmiyorsa hücreyi boş bırakın.',
    };
  }

  if (field === 'patient.firstName' || field === 'patient.lastName') {
    return {
      code: 'MISSING_REQUIRED_NAME',
      messageTr:
        field === 'patient.firstName' ? 'Hasta adı boş.' : 'Hasta soyadı boş.',
      guidanceTr:
        'ADI ve SOYADI sütunlarını doldurun. Ad ve soyad NoraMedi’de zorunludur; bu iki alan olmadan hasta kaydı açılamaz.',
    };
  }

  if (field === 'provenance.sourceId') {
    return {
      code: 'MISSING_SOURCE_RECORD_ID',
      messageTr:
        'Kaynak kayıt numarası (HASTA_ID) boş. Bu numara olmadan kayıt tekrar aktarımlarda eşleştirilemez ve mükerrer hasta oluşur.',
      guidanceTr:
        'HASTA_ID sütununu eski sistemdeki kayıt numarasıyla doldurun. Bu numara hastaya gösterilmez; yalnızca aktarım eşleştirmesi için kullanılır.',
    };
  }

  if (
    field === 'patient.phone' ||
    field.startsWith('patient.contactPoint.')
  ) {
    return {
      code: 'INVALID_PHONE',
      messageTr: 'Telefon numarası geçerli bir numaraya dönüştürülemedi.',
      guidanceTr:
        'Numarayı 05XXXXXXXXX veya +905XXXXXXXXX biçiminde yazın. Numara yoksa hücreyi boş bırakın; hasta telefonsuz da aktarılır.',
    };
  }

  return {
    code: 'INVALID_FIELD_VALUE',
    messageTr: `"${field || 'bilinmeyen alan'}" alanındaki değer NoraMedi tarafından kabul edilmedi.`,
    guidanceTr:
      'İlgili sütundaki değeri düzeltin veya hücreyi boşaltın. Alan zorunlu değilse boş bırakmak kaydı aktarılabilir hale getirir.',
  };
}

/**
 * Classify ONE built row. Returns `null` when the row is importable.
 *
 * `null` deliberately does NOT mean "perfect": a row with warnings (a
 * quarantined legacy TC number, a normalized value) still imports, and telling
 * the operator to fix it in Excel would be wrong — the warning is about what we
 * did with the value, not about the value being unusable.
 */
export function classifyRowRejection(
  row: BuiltRow,
  ctx: RowRejectionContext,
): RowRejection | null {
  if (row.failures.length > 0) {
    return {
      rowNumber: row.rowNumber,
      sourceId: row.sourceId,
      kind: 'INVALID',
      findings: row.failures.map((failure) => ({
        internalCode: failure.code,
        fieldName: failure.fieldName ?? null,
        internalMessage: failure.message,
        ...classifyFailure(failure.code, failure.fieldName, failure.message),
      })),
    };
  }

  if (row.sourceId && (ctx.sourceIdCounts.get(row.sourceId) ?? 0) > 1) {
    return {
      rowNumber: row.rowNumber,
      sourceId: row.sourceId,
      kind: 'DUPLICATE_SOURCE',
      findings: [
        {
          code: 'DUPLICATE_OR_AMBIGUOUS_REFERENCE',
          internalCode: 'DUPLICATE_SOURCE_RECORD',
          fieldName: 'provenance.sourceId',
          internalMessage:
            'This source record id appears on more than one row. Both rows are held for manual review rather than collapsed into one patient.',
          messageTr:
            'Bu kaynak kayıt numarası (HASTA_ID) dosyada birden fazla satırda geçiyor. İki satır tek hastada birleştirilmedi; ikisi de bekletiliyor.',
          guidanceTr:
            'Satırların gerçekten aynı hasta olup olmadığını kontrol edin. Aynı hastaysa fazla satırı silin; farklı hastalarsa HASTA_ID değerlerini eski sistemdeki gerçek numaralarıyla ayırın.',
        },
      ],
    };
  }

  if (row.practitionerSourceValue && ctx.unresolvedReferenceValues.has(row.practitionerSourceValue)) {
    return {
      rowNumber: row.rowNumber,
      sourceId: row.sourceId,
      kind: 'REFERENCE_UNRESOLVED',
      findings: [
        {
          code: 'UNRESOLVED_PRACTITIONER_REFERENCE',
          internalCode: 'REFERENCE_UNRESOLVED',
          fieldName: 'patient.primaryPractitionerId',
          internalMessage:
            'The source practitioner for this row has not been mapped to an existing NoraMedi user.',
          messageTr:
            'Bu satırdaki hekim kodu henüz bir NoraMedi kullanıcısına eşlenmedi.',
          // Deliberately NOT "fix the workbook": editing the vendor id in Excel
          // would create a second unmapped value instead of resolving the first.
          guidanceTr:
            'Bu kaydı Excel’de düzeltmeyin. “Referans Eşleme” adımına dönüp bu hekim kodunu bir NoraMedi kullanıcısına eşleyin veya “aktarılmayacak” olarak işaretleyin; ardından Deneme Çalıştırmasını tekrarlayın.',
        },
      ],
    };
  }

  return null;
}
