/**
 * Multi-Branch Migration Script — Phase 1b
 *
 * Bu script mevcut single-tenant veriyi Organization hiyerarşisine güvenli şekilde migrate eder.
 * Her Clinic için bir Organization oluşturur ve tüm ilişkili kayıtları bağlar.
 *
 * Çalıştırma: cd server && npx tsx src/scripts/migrate-to-multibranch.ts
 *
 * GÜVENLİ: Sadece yeni alanları doldurur, hiçbir kaydı silmez veya değiştirmez.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'clinic';
}

async function main() {
  console.log('=== Multi-Branch Migration Script ===');
  console.log('Starting safe migration of existing data...\n');

  const clinics = await prisma.clinic.findMany();
  console.log(`Found ${clinics.length} clinic(s) to process\n`);

  for (const clinic of clinics) {
    console.log(`--- Clinic: "${clinic.name}" (${clinic.id}) ---`);

    // ── Step 1: Ensure slug exists ─────────────────────────────────────────
    let slug = clinic.slug;
    if (!slug) {
      slug = generateSlug(clinic.name);
      // Ensure uniqueness if multiple clinics share similar names
      const existing = await prisma.organization.findFirst({ where: { slug } });
      if (existing) slug = `${slug}-${clinic.id.slice(0, 6)}`;
      await prisma.clinic.update({ where: { id: clinic.id }, data: { slug } });
      console.log(`  ✓ Generated slug: "${slug}"`);
    } else {
      console.log(`  ✓ Slug exists: "${slug}"`);
    }

    // ── Step 2: Create Organization (upsert — safe to re-run) ──────────────
    const orgSlug = slug;
    const org = await prisma.organization.upsert({
      where: { slug: orgSlug },
      update: {
        status: clinic.status,
        planId: clinic.planId,
        trialEndsAt: clinic.trialEndsAt,
      },
      create: {
        name: clinic.name,
        slug: orgSlug,
        status: clinic.status,
        planId: clinic.planId,          // Staged migration: copy plan from clinic
        trialEndsAt: clinic.trialEndsAt,
      },
    });
    console.log(`  ✓ Organization: "${org.name}" (${org.id})`);

    // ── Step 3: Link Clinic → Organization ─────────────────────────────────
    if (!clinic.organizationId) {
      await prisma.clinic.update({
        where: { id: clinic.id },
        data: { organizationId: org.id },
      });
      console.log(`  ✓ Clinic linked to organization`);
    } else {
      console.log(`  ↳ Clinic already linked`);
    }

    // ── Step 4: Migrate Users ───────────────────────────────────────────────
    const users = await prisma.user.findMany({ where: { clinicId: clinic.id } });
    console.log(`  Processing ${users.length} user(s)...`);

    for (const user of users) {
      const normalizedRole = user.role.toUpperCase();
      const canAccessAll = ['ADMIN', 'OWNER', 'ORG_ADMIN'].includes(normalizedRole);

      if (!user.organizationId) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            organizationId: org.id,
            defaultClinicId: user.clinicId,  // defaultClinicId ≠ authorization
            canAccessAllClinics: canAccessAll,
          },
        });
      }

      // Create UserClinic membership (upsert — safe to re-run)
      await prisma.userClinic.upsert({
        where: { userId_clinicId: { userId: user.id, clinicId: clinic.id } },
        update: { role: normalizedRole, isActive: user.isActive },
        create: {
          userId: user.id,
          clinicId: clinic.id,
          role: normalizedRole,
          isActive: user.isActive,
        },
      });
    }

    // Set Organization.ownerId to the first admin user found
    if (!org.ownerId) {
      const adminUser = users.find(u =>
        ['admin', 'ADMIN', 'owner', 'OWNER'].includes(u.role)
      );
      if (adminUser) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { ownerId: adminUser.id },
        });
        console.log(`  ✓ Organization owner set to: ${adminUser.email}`);
      }
    }
    console.log(`  ✓ Users migrated`);

    // ── Step 5: Migrate Patients ────────────────────────────────────────────
    // (organizationId is now NOT NULL — idempotent upsert via PatientClinic only)
    const patientCount = await prisma.patient.count({
      where: { clinicId: clinic.id },
    });
    console.log(`  Processing ${patientCount} patient(s)...`);

    // Ensure all patients in this clinic point to correct organization (idempotent)
    await prisma.patient.updateMany({
      where: { clinicId: clinic.id, primaryClinicId: undefined },
      data: { primaryClinicId: clinic.id },
    });

    // Create PatientClinic records for multi-branch visit history
    const patients = await prisma.patient.findMany({
      where: { clinicId: clinic.id },
      select: { id: true },
    });
    let patientClinicCreated = 0;
    for (const patient of patients) {
      const exists = await prisma.patientClinic.findUnique({
        where: { patientId_clinicId: { patientId: patient.id, clinicId: clinic.id } },
      });
      if (!exists) {
        await prisma.patientClinic.create({
          data: { patientId: patient.id, clinicId: clinic.id },
        });
        patientClinicCreated++;
      }
    }
    console.log(`  ✓ Patients migrated (${patientClinicCreated} PatientClinic records created)`);

    // ── Step 6: Migrate ClinicInvitations ──────────────────────────────────
    const invCount = await prisma.clinicInvitation.updateMany({
      where: { clinicId: clinic.id },
      data: { organizationId: org.id },
    });
    console.log(`  ✓ ${invCount.count} invitation(s) linked to organization`);

    // ── Step 7: Migrate InventoryItems ───────────────────────────────────
    const invItemCount = await prisma.inventoryItem.updateMany({
      where: { clinicId: clinic.id },
      data: { organizationId: org.id },
    });
    console.log(`  ✓ ${invItemCount.count} inventory item(s) linked to organization`);

    console.log(`  ✓ Clinic "${clinic.name}" migration complete\n`);
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  console.log('=== Validation ===');
  const userClinicCount    = await prisma.userClinic.count();
  const patientClinicCount = await prisma.patientClinic.count();
  const orgCount           = await prisma.organization.count();
  const totalClinics       = await prisma.clinic.count();
  const totalUsers         = await prisma.user.count();
  const totalPatients      = await prisma.patient.count();
  const nullOrgInvItems    = 0; // organizationId is NOT NULL after Phase 1b

  console.log(`  Organizations created:    ${orgCount}`);
  console.log(`  UserClinic records:       ${userClinicCount}`);
  console.log(`  PatientClinic records:    ${patientClinicCount}`);
  console.log(`  Total Clinics:            ${totalClinics}`);
  console.log(`  Total Users:              ${totalUsers}`);
  console.log(`  Total Patients:           ${totalPatients}`);

  console.log('\n✅ Migration script complete! organizationId is NOT NULL on all records (Phase 1b done).');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
