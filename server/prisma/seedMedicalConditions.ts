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
 * Run: npx tsx prisma/seedMedicalConditions.ts
 * Requires DATABASE_URL to point at the target database.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

type SeedCondition = {
  code: string;
  category: 'systemic' | 'allergy' | 'medication_risk' | 'dental' | 'obstetric' | 'behavioral';
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
  { code: 'J45.9', category: 'systemic', nameEn: 'Asthma, unspecified', nameTr: 'Astım, tanımlanmamış' },
  { code: 'G40.9', category: 'systemic', nameEn: 'Epilepsy, unspecified', nameTr: 'Epilepsi, tanımlanmamış' },
  { code: 'D68.9', category: 'systemic', nameEn: 'Coagulation defect, unspecified', nameTr: 'Tanımlanmamış pıhtılaşma bozukluğu' },
  { code: 'M81.0', category: 'systemic', nameEn: 'Osteoporosis without current pathological fracture', nameTr: 'Patolojik kırık olmaksızın osteoporoz' },
  { code: 'B18.1', category: 'systemic', nameEn: 'Chronic viral hepatitis B', nameTr: 'Kronik viral hepatit B' },
  { code: 'B18.2', category: 'systemic', nameEn: 'Chronic viral hepatitis C', nameTr: 'Kronik viral hepatit C' },
  { code: 'B20', category: 'systemic', nameEn: 'Human immunodeficiency virus [HIV] disease', nameTr: 'İnsan bağışıklık yetmezliği virüsü [HIV] hastalığı' },

  // ── Allergy status (documented drug/material allergy) ──────────────────
  { code: 'Z88.0', category: 'allergy', nameEn: 'Allergy status to penicillin', nameTr: 'Penisilin alerjisi öyküsü' },
  { code: 'Z88.4', category: 'allergy', nameEn: 'Allergy status to other anti-infective agent', nameTr: 'Diğer enfeksiyon önleyici ajanlara alerji öyküsü' },
  { code: 'Z91.010', category: 'allergy', nameEn: 'Allergy to latex', nameTr: 'Lateks alerjisi' },

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

async function main() {
  let created = 0;
  let updated = 0;

  for (const entry of CATALOG) {
    const existing = await prisma.medicalCondition.findUnique({ where: { code: entry.code }, select: { id: true } });
    await prisma.medicalCondition.upsert({
      where: { code: entry.code },
      create: { code: entry.code, category: entry.category, nameEn: entry.nameEn, nameTr: entry.nameTr },
      update: { category: entry.category, nameEn: entry.nameEn, nameTr: entry.nameTr },
    });
    if (existing) updated++;
    else created++;
  }

  console.log(`[seedMedicalConditions] done — ${created} created, ${updated} updated, ${CATALOG.length} total in catalog.`);
}

main()
  .catch((err) => {
    console.error('[seedMedicalConditions] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
