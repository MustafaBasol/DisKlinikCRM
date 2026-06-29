/**
 * repair-owner-admin.ts — Production Owner Admin Onarım Betiği
 *
 * Amaç:
 *   Production'da `admin` rolüne sahip kullanıcıların `canAccessAllClinics`
 *   bayrağı eksikse veya yanlışsa bunu düzeltir.
 *
 *   Kural: role='admin' + canAccessAllClinics=true → OWNER (normalizeRole)
 *          role='admin' + canAccessAllClinics=false → CLINIC_MANAGER (HATALI)
 *
 * Güvenli kullanım:
 *   - Bu betik yalnızca manuel/tek seferlik production onarımı içindir.
 *   - Normal uygulama akışında (registration, seed) bu flag otomatik set edilir.
 *   - Kullanıcı belirtilmezse: organizasyon başına ilk admin kullanıcısı onarılır.
 *
 * Çalıştırma:
 *   cd server && npx tsx src/scripts/repair-owner-admin.ts
 *
 *   Belirli e-posta için:
 *   cd server && npx tsx src/scripts/repair-owner-admin.ts admin@ailedis.com
 *
 * Eşdeğer SQL (doğrudan DB erişiminde):
 *
 *   -- Belirli bir kullanıcı için:
 *   UPDATE "User"
 *   SET "canAccessAllClinics" = true
 *   WHERE email = '<owner-admin-email>'
 *     AND role = 'admin';
 *
 *   -- Organizasyon başına ilk admin kullanıcısını onar:
 *   UPDATE "User"
 *   SET "canAccessAllClinics" = true
 *   WHERE role = 'admin'
 *     AND "canAccessAllClinics" = false;
 *
 *   -- Doğrulama:
 *   SELECT id, email, role, "canAccessAllClinics", "defaultClinicId"
 *   FROM "User"
 *   WHERE role = 'admin';
 *
 *   -- UserClinic kaydı eksikse ekle (admin'in kendi kliniğine erişimi için):
 *   INSERT INTO "UserClinic" (id, "userId", "clinicId", role, "isActive", "createdAt", "updatedAt")
 *   SELECT gen_random_uuid(), u.id, u."clinicId", 'ADMIN', true, now(), now()
 *   FROM "User" u
 *   WHERE u.role = 'admin'
 *     AND NOT EXISTS (
 *       SELECT 1 FROM "UserClinic" uc
 *       WHERE uc."userId" = u.id AND uc."clinicId" = u."clinicId"
 *     );
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!),
});

async function main() {
  const targetEmail = process.argv[2];

  if (targetEmail) {
    // ── Belirli kullanıcıyı onar ──────────────────────────────────────────
    console.log(`Hedef kullanıcı: ${targetEmail}`);

    const user = await prisma.user.findFirst({
      where: { email: targetEmail, role: 'admin' },
      include: { userClinics: true },
    });

    if (!user) {
      console.error(`Hata: '${targetEmail}' e-postasına sahip admin kullanıcı bulunamadı.`);
      process.exit(1);
    }

    if (user.canAccessAllClinics) {
      console.log(`✓ ${targetEmail} zaten canAccessAllClinics=true. İşlem gerekmez.`);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { canAccessAllClinics: true },
      });
      console.log(`✓ ${targetEmail} — canAccessAllClinics true olarak güncellendi.`);
    }

    // UserClinic kaydı yoksa ekle
    const hasUserClinic = user.userClinics.some(uc => uc.clinicId === user.clinicId);
    if (!hasUserClinic) {
      await prisma.userClinic.create({
        data: { userId: user.id, clinicId: user.clinicId, role: 'ADMIN', isActive: true },
      });
      console.log(`✓ UserClinic kaydı oluşturuldu: ${user.clinicId}`);
    } else {
      console.log(`✓ UserClinic kaydı zaten mevcut.`);
    }

    // defaultClinicId yoksa set et
    if (!user.defaultClinicId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultClinicId: user.clinicId },
      });
      console.log(`✓ defaultClinicId set edildi: ${user.clinicId}`);
    }

    // Organization owner yoksa set et
    const org = await prisma.organization.findUnique({ where: { id: user.organizationId } });
    if (org && !org.ownerId) {
      await prisma.organization.update({
        where: { id: org.id },
        data: { ownerId: user.id },
      });
      console.log(`✓ Organization.ownerId set edildi.`);
    }

    console.log(`\n✅ Onarım tamamlandı. Kullanıcının yeniden giriş yapması gerekiyor.`);
  } else {
    // ── Tüm admin kullanıcıları tara ve onar ─────────────────────────────
    console.log('E-posta belirtilmedi. Tüm admin kullanıcıları taranıyor...');

    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      include: { userClinics: true },
    });

    if (admins.length === 0) {
      console.log('Hiç admin kullanıcı bulunamadı.');
      process.exit(0);
    }

    let repaired = 0;

    for (const user of admins) {
      const repairs: string[] = [];

      if (!user.canAccessAllClinics) {
        await prisma.user.update({
          where: { id: user.id },
          data: { canAccessAllClinics: true },
        });
        repairs.push('canAccessAllClinics=true');
      }

      const hasUserClinic = user.userClinics.some(uc => uc.clinicId === user.clinicId);
      if (!hasUserClinic) {
        await prisma.userClinic.create({
          data: { userId: user.id, clinicId: user.clinicId, role: 'ADMIN', isActive: true },
        });
        repairs.push('UserClinic oluşturuldu');
      }

      if (!user.defaultClinicId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { defaultClinicId: user.clinicId },
        });
        repairs.push('defaultClinicId set edildi');
      }

      if (repairs.length > 0) {
        console.log(`  ✓ ${user.email}: ${repairs.join(', ')}`);
        repaired++;
      } else {
        console.log(`  ○ ${user.email}: zaten doğru yapılandırılmış.`);
      }
    }

    console.log(`\n✅ ${admins.length} admin tarandı, ${repaired} kullanıcı onarıldı.`);
    console.log('Etkilenen kullanıcıların yeniden giriş yapması gerekiyor.');
  }
}

main()
  .catch((e) => {
    console.error('Onarım başarısız:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
