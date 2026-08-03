/**
 * medicalConditionCatalogCanonical.ts — reviewed canonical ICD-10-CM
 * mapping fixture for US-01.1-P1's MedicalCondition seed catalog
 * (server/prisma/seedMedicalConditions.ts).
 *
 * AUTHORITATIVE SOURCE: CDC/NCHS ICD-10-CM Fiscal Year 2026 code set,
 * "icd10cm-Code Descriptions-2026.zip" (icd10cm-order-2026.txt /
 * icd10cm-codes-2026.txt, file-dated 2025-06-10), published by CDC/NCHS at
 *   https://ftp.cdc.gov/pub/health_statistics/nchs/publications/ICD10CM/2026/
 * Retrieved and cross-checked directly against that file's `billable`
 * column and long-description column on 2026-08-03. Every `canonical`
 * value below is copied verbatim from that source — not from any
 * commercial coding site, blog, or memory.
 *
 * This fixture exists to make the catalog-integrity test
 * (medicalConditionCatalogIntegrity.test.ts) a durable drift guard: if a
 * future edit to seedMedicalConditions.ts's CATALOG changes a `nameEn`
 * away from its reviewed canonical descriptor, or reintroduces one of the
 * two codes known to have been mislabeled during the 2026-08-03 audit
 * (TRAP_CODES below), the test fails loudly instead of silently shipping
 * a clinical-data-safety regression.
 *
 * `billable` reflects the FY2026 order file's billable flag (1 = billable
 * leaf code selectable as a real diagnosis, 0 = non-billable category
 * header that cannot be used alone).
 */

export type CanonicalEntry = {
  code: string;
  canonical: string;
  billable: boolean;
};

/** Every code currently in CATALOG, keyed by its corrected code. */
export const CANONICAL_CATALOG: readonly CanonicalEntry[] = [
  { code: 'E11.9', canonical: 'Type 2 diabetes mellitus without complications', billable: true },
  { code: 'I10', canonical: 'Essential (primary) hypertension', billable: true },
  { code: 'J45.909', canonical: 'Unspecified asthma, uncomplicated', billable: true },
  { code: 'G40.909', canonical: 'Epilepsy, unspecified, not intractable, without status epilepticus', billable: true },
  { code: 'D68.9', canonical: 'Coagulation defect, unspecified', billable: true },
  { code: 'M81.0', canonical: 'Age-related osteoporosis without current pathological fracture', billable: true },
  { code: 'B18.1', canonical: 'Chronic viral hepatitis B without delta-agent', billable: true },
  { code: 'B18.2', canonical: 'Chronic viral hepatitis C', billable: true },
  { code: 'B20', canonical: 'Human immunodeficiency virus [HIV] disease', billable: true },
  { code: 'Z88.0', canonical: 'Allergy status to penicillin', billable: true },
  { code: 'Z88.3', canonical: 'Allergy status to other anti-infective agents', billable: true },
  { code: 'Z91.040', canonical: 'Latex allergy status', billable: true },
  { code: 'Z79.01', canonical: 'Long term (current) use of anticoagulants', billable: true },
  { code: 'Z79.4', canonical: 'Long term (current) use of insulin', billable: true },
  { code: 'Z79.83', canonical: 'Long term (current) use of bisphosphonates', billable: true },
  { code: 'K02.9', canonical: 'Dental caries, unspecified', billable: true },
  { code: 'K04.7', canonical: 'Periapical abscess without sinus', billable: true },
  { code: 'K05.00', canonical: 'Acute gingivitis, plaque induced', billable: true },
  { code: 'Z33.1', canonical: 'Pregnant state, incidental', billable: true },
  { code: 'F41.9', canonical: 'Anxiety disorder, unspecified', billable: true },
  { code: 'Z87.891', canonical: 'Personal history of nicotine dependence', billable: true },
];

/**
 * Codes CONFIRMED, against the FY2026 source above, to mean something
 * different from what an earlier (pre-audit) version of the seed catalog
 * claimed. These codes are deliberately ABSENT from CATALOG today — this
 * table exists purely so a future re-introduction under the wrong meaning
 * is caught immediately, rather than silently reproducing the original
 * clinical-coding error.
 */
export const TRAP_CODES: readonly CanonicalEntry[] = [
  // Was mislabeled "Allergy to latex" pre-audit. Actually peanuts.
  { code: 'Z91.010', canonical: 'Allergy to peanuts', billable: true },
  // Was mislabeled "Allergy status to other anti-infective agent" pre-audit.
  // Actually anesthetic agent (e.g. local anesthetics used in dentistry).
  { code: 'Z88.4', canonical: 'Allergy status to anesthetic agent', billable: true },
  // Non-billable FY2026 header codes replaced by their billable leaf codes
  // (J45.909, G40.909) during the same audit.
  { code: 'J45.9', canonical: 'Other and unspecified asthma', billable: false },
  { code: 'G40.9', canonical: 'Epilepsy, unspecified', billable: false },
];
