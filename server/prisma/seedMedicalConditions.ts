/**
 * seedMedicalConditions.ts — US-01.1-P1 deterministic, idempotent seed for
 * the MedicalCondition lookup catalog.
 *
 * Unlike seed.ts (destructive demo data, refuses to run in production
 * without ALLOW_PROD_SEED=true), this script is purely additive:
 *  - upserts each row BY ITS UNIQUE `code` — safe to re-run any number of
 *    times, in any environment, including production.
 *  - never deletes a MedicalCondition row (an existing code is updated
 *    in-place if its category/name text changes; nothing is removed even
 *    if it is later dropped from CATALOG below, since PatientCondition rows
 *    may already reference it — RESTRICT-only foreign keys everywhere,
 *    per the model's design comment in schema.prisma).
 *
 * Scope: this is a SMALL, documented, dental-clinic-relevant INITIAL subset
 * of standard ICD-10 codes — not the global ICD-10 catalog, and not a
 * substitute for clinical judgment. Codes below are standard, publicly
 * documented ICD-10/ICD-10-CM identifiers grouped into the categories this
 * feature's application layer understands (see
 * services/medicalHistory.ts). No clinical claims are made beyond each
 * code's standard definition. Extend this list additively in a later phase
 * (P2+) — never repurpose an existing `code` for a different meaning.
 *
 * AUTHORITATIVE SOURCE (2026-08-03 audit): every `code`/`nameEn` pair below
 * has been verified verbatim against the official CDC/NCHS ICD-10-CM
 * Fiscal Year 2026 code set — "icd10cm-Code Descriptions-2026.zip"
 * (icd10cm-order-2026.txt / icd10cm-codes-2026.txt, file-dated 2025-06-10),
 * published by CDC/NCHS at:
 *   https://ftp.cdc.gov/pub/health_statistics/nchs/publications/ICD10CM/2026/
 * Every `nameEn` value is the exact FY2026 long descriptor for its code —
 * no shortened/paraphrased UI labels are used, so there is no
 * canonical-vs-product-label divergence to track. A reviewed canonical
 * fixture asserting this (server/src/tests/fixtures/
 * medicalConditionCatalogCanonical.ts) is checked by
 * medicalConditionCatalogIntegrity.test.ts — see that file for the
 * full per-code source citation and the record of two corrected
 * clinical-coding errors found during the 2026-08-03 audit:
 *   - Z91.010 is "Allergy to peanuts", NOT latex (latex is Z91.040).
 *   - Z88.4 is "Allergy status to anesthetic agent", NOT "other
 *     anti-infective agent" (that meaning is Z88.3).
 *   Two non-billable FY2026 header codes were also found and replaced by
 *   their correct billable leaf codes: J45.9 -> J45.909, G40.9 -> G40.909.
 *
 * Run: npx tsx prisma/seedMedicalConditions.ts
 * Requires DATABASE_URL to point at the target database.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

export const SEED_CONDITION_CATEGORIES = ['systemic', 'allergy', 'medication_risk', 'dental', 'obstetric', 'behavioral'] as const;

export type SeedConditionCategory = (typeof SEED_CONDITION_CATEGORIES)[number];

export type SeedCondition = {
  code: string;
  category: SeedConditionCategory;
  nameEn: string;
  nameTr: string;
};

/**
 * Initial dental-clinic-relevant catalog. Each entry is a standard ICD-10 /
 * ICD-10-CM code with its official short description — chosen because it is
 * commonly relevant to dental treatment planning (bleeding risk, infection
 * risk, anesthesia/medication interactions, MRONJ risk, triage/behavioral
 * accommodation), not because it is the most common condition overall.
 */
export const CATALOG: SeedCondition[] = [
  // ── Systemic conditions relevant to dental treatment planning ──────────
  { code: 'E11.9', category: 'systemic', nameEn: 'Type 2 diabetes mellitus without complications', nameTr: 'Komplikasyonsuz Tip 2 diabetes mellitus' },
  { code: 'I10', category: 'systemic', nameEn: 'Essential (primary) hypertension', nameTr: 'Esansiyel (primer) hipertansiyon' },
  // J45.9 is a non-billable FY2026 header code (see order file, billable flag 0)
  // — replaced by its billable leaf code J45.909, same clinical meaning.
  { code: 'J45.909', category: 'systemic', nameEn: 'Unspecified asthma, uncomplicated', nameTr: 'Tanımlanmamış astım, komplikasyonsuz' },
  // G40.9 is likewise a non-billable FY2026 header code — replaced by its
  // billable leaf code G40.909, same clinical meaning.
  { code: 'G40.909', category: 'systemic', nameEn: 'Epilepsy, unspecified, not intractable, without status epilepticus', nameTr: 'Epilepsi, tanımlanmamış, dirençli olmayan, status epileptikus olmaksızın' },
  { code: 'D68.9', category: 'systemic', nameEn: 'Coagulation defect, unspecified', nameTr: 'Tanımlanmamış pıhtılaşma bozukluğu' },
  { code: 'M81.0', category: 'systemic', nameEn: 'Age-related osteoporosis without current pathological fracture', nameTr: 'Güncel patolojik kırık olmaksızın yaşa bağlı osteoporoz' },
  { code: 'B18.1', category: 'systemic', nameEn: 'Chronic viral hepatitis B without delta-agent', nameTr: 'Delta ajanı olmaksızın kronik viral hepatit B' },
  { code: 'B18.2', category: 'systemic', nameEn: 'Chronic viral hepatitis C', nameTr: 'Kronik viral hepatit C' },
  { code: 'B20', category: 'systemic', nameEn: 'Human immunodeficiency virus [HIV] disease', nameTr: 'İnsan bağışıklık yetmezliği virüsü [HIV] hastalığı' },

  // ── Allergy status (documented drug/material allergy) ──────────────────
  { code: 'Z88.0', category: 'allergy', nameEn: 'Allergy status to penicillin', nameTr: 'Penisilin alerjisi öyküsü' },
  // Corrected 2026-08-03: this row previously used the WRONG code Z88.4
  // (which is actually "Allergy status to anesthetic agent") for this
  // meaning. Z88.3 is the correct code for "other anti-infective agents".
  { code: 'Z88.3', category: 'allergy', nameEn: 'Allergy status to other anti-infective agents', nameTr: 'Diğer enfeksiyon önleyici ajanlara alerji öyküsü' },
  // Corrected 2026-08-03: this row previously used the WRONG code Z91.010
  // (which is actually "Allergy to peanuts") for this meaning. Z91.040 is
  // the correct code for latex allergy status.
  { code: 'Z91.040', category: 'allergy', nameEn: 'Latex allergy status', nameTr: 'Lateks alerjisi durumu' },

  // ── Long-term medication use relevant to dental treatment risk ─────────
  { code: 'Z79.01', category: 'medication_risk', nameEn: 'Long term (current) use of anticoagulants', nameTr: 'Uzun süreli (mevcut) antikoagülan kullanımı' },
  { code: 'Z79.4', category: 'medication_risk', nameEn: 'Long term (current) use of insulin', nameTr: 'Uzun süreli (mevcut) insülin kullanımı' },
  { code: 'Z79.83', category: 'medication_risk', nameEn: 'Long term (current) use of bisphosphonates', nameTr: 'Uzun süreli (mevcut) bifosfonat kullanımı' },

  // ── Dental-specific findings ────────────────────────────────────────────
  { code: 'K02.9', category: 'dental', nameEn: 'Dental caries, unspecified', nameTr: 'Diş çürüğü, tanımlanmamış' },
  { code: 'K04.7', category: 'dental', nameEn: 'Periapical abscess without sinus', nameTr: 'Sinüs oluşumu olmaksızın periapikal apse' },
  { code: 'K05.00', category: 'dental', nameEn: 'Acute gingivitis, plaque induced', nameTr: 'Plak kaynaklı akut gingivit' },

  // ── Obstetric status ────────────────────────────────────────────────────
  { code: 'Z33.1', category: 'obstetric', nameEn: 'Pregnant state, incidental', nameTr: 'Tesadüfi gebelik durumu' },

  // ── Behavioral/psychiatric relevant to dental anxiety management ───────
  { code: 'F41.9', category: 'behavioral', nameEn: 'Anxiety disorder, unspecified', nameTr: 'Anksiyete bozukluğu, tanımlanmamış' },
  { code: 'Z87.891', category: 'behavioral', nameEn: 'Personal history of nicotine dependence', nameTr: 'Kişisel nikotin bağımlılığı öyküsü' },
];

/**
 * Runs the idempotent upsert against the given Prisma client (defaults to
 * this module's own client for CLI use). Exported — not just invoked as a
 * side effect — so tests can exercise the REAL seed logic (including
 * re-run idempotency) against a disposable Postgres instance without a
 * second connection pool or duplicating the upsert logic.
 */
export async function runSeedMedicalConditions(
  client: Pick<PrismaClient, 'medicalCondition'> = prisma,
): Promise<{ created: number; updated: number; total: number }> {
  let created = 0;
  let updated = 0;

  for (const entry of CATALOG) {
    const existing = await client.medicalCondition.findUnique({ where: { code: entry.code }, select: { id: true } });
    await client.medicalCondition.upsert({
      where: { code: entry.code },
      create: { code: entry.code, category: entry.category, nameEn: entry.nameEn, nameTr: entry.nameTr },
      update: { category: entry.category, nameEn: entry.nameEn, nameTr: entry.nameTr },
    });
    if (existing) updated++;
    else created++;
  }

  return { created, updated, total: CATALOG.length };
}

// Only auto-run when executed directly (`npx tsx prisma/seedMedicalConditions.ts`),
// never as a side effect of another module importing CATALOG/runSeedMedicalConditions
// (e.g. the catalog-integrity/idempotency tests).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeedMedicalConditions()
    .then(({ created, updated, total }) => {
      console.log(`[seedMedicalConditions] done — ${created} created, ${updated} updated, ${total} total in catalog.`);
    })
    .catch((err) => {
      console.error('[seedMedicalConditions] failed:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
