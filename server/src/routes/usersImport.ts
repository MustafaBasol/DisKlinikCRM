/**
 * usersImport.ts — Kullanıcı/personel Excel içe aktarma endpoint'leri (Sprint 22)
 *
 * GET  /api/users/import-template  → .xlsx şablon indir
 * POST /api/users/import-preview   → doğrulama önizleme (DB yazma yok)
 * POST /api/users/import-confirm   → geçerli satırları içe aktar
 *
 * İzin verilen roller: OWNER, ORG_ADMIN, CLINIC_MANAGER
 */

import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { logActivity } from '../utils/activity.js';
import { getAccessibleClinicIds } from '../utils/clinicScope.js';
import {
  buildUserTemplate,
  parseExcelFile,
  ImportRowResult,
  MAX_IMPORT_ROWS,
  MAX_FILE_SIZE_BYTES,
} from '../utils/excelImport.js';
import { sendMail } from '../services/emailService.js';
import { buildStaffOnboardingEmail } from '../services/emailTemplates.js';
import { createPasswordResetToken, RESET_TOKEN_EXPIRY_MINUTES } from '../utils/passwordResetToken.js';

const router = express.Router();

// ── Multer: bellek içi ─────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
});

function handleExcelUpload(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single('file')(req as any, res as any, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Dosya 5 MB sınırını aşıyor' });
    }
    if (err?.message === 'INVALID_FILE_TYPE') {
      return res.status(400).json({ error: 'Yalnızca .xlsx dosyaları kabul edilir' });
    }
    return res.status(400).json({ error: 'Dosya yükleme hatası' });
  });
}

// ─── İzin verilen roller ──────────────────────────────────────────────────────
const IMPORT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

// Roller: clinic_manager'ın atayabileceği roller (OWNER/ORG_ADMIN hariç)
const MANAGER_ALLOWED_ROLES = new Set(['doctor', 'receptionist', 'billing', 'assistant', 'admin']);
const ALL_ALLOWED_ROLES = new Set(['owner', 'org_admin', 'admin', 'doctor', 'receptionist', 'billing', 'assistant', 'clinic_manager']);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/import-template
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/users/import-template',
  authorize(IMPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const accessibleIds = await getAccessibleClinicIds(req.user!);
      const clinics = await prisma.clinic.findMany({
        where: { id: { in: accessibleIds }, organizationId: req.user!.organizationId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const buf = await buildUserTemplate(clinics);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="kullanici-import-sablonu.xlsx"');
      res.send(buf);
    } catch (err: any) {
      console.error('[users/import-template]', err?.message);
      res.status(500).json({ error: 'Şablon oluşturulamadı' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Ortak: satır doğrulama mantığı
// ─────────────────────────────────────────────────────────────────────────────
interface UserRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  clinicIds?: string;
  phone?: string;
  password?: string;
  canAccessAllClinics?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateTempPassword(): string {
  return 'Tmp' + crypto.randomBytes(5).toString('hex') + '!';
}

async function validateUserRows(
  rows: Record<string, string>[],
  orgId: string,
  accessibleIds: string[],
  callerRole: string,
): Promise<{ results: ImportRowResult[]; tempPasswords: Map<number, string> }> {
  // Organizasyon içindeki mevcut e-postalar
  const existingUsers = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: { email: true },
  });
  const existingEmails = new Set(existingUsers.map((u: { email: string }) => u.email.toLowerCase()));

  const seenEmails = new Set<string>();
  const results: ImportRowResult[] = [];
  const tempPasswords = new Map<number, string>();

  const isManager = callerRole === 'CLINIC_MANAGER';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as UserRow;
    const rowNumber = i + 2;
    const errors: string[] = [];

    // Zorunlu alanlar
    if (!row.firstName?.trim()) errors.push('firstName zorunludur');
    if (!row.lastName?.trim()) errors.push('lastName zorunludur');

    const email = row.email?.trim().toLowerCase() ?? '';
    if (!email) {
      errors.push('email zorunludur');
    } else if (!EMAIL_RE.test(email)) {
      errors.push('E-posta formatı geçersiz');
    } else {
      if (existingEmails.has(email)) errors.push(`Bu e-posta zaten kayıtlı: ${email}`);
      if (seenEmails.has(email)) errors.push(`Bu e-posta dosyada tekrar ediyor: ${email}`);
      seenEmails.add(email);
    }

    // Rol
    const role = row.role?.trim().toLowerCase() ?? '';
    if (!role) {
      errors.push('role zorunludur');
    } else if (!ALL_ALLOWED_ROLES.has(role)) {
      errors.push(`Geçersiz rol: ${row.role}. İzin verilenler: admin, doctor, receptionist, billing, assistant`);
    } else if (isManager && !MANAGER_ALLOWED_ROLES.has(role)) {
      errors.push(`CLINIC_MANAGER bu rolü atayamaz: ${row.role}`);
    }

    // canAccessAllClinics
    const canAccessAll = row.canAccessAllClinics?.trim().toLowerCase() === 'true';
    if (canAccessAll && isManager) {
      errors.push('CLINIC_MANAGER canAccessAllClinics=true olan kullanıcı oluşturamaz');
    }

    // clinicIds
    const clinicIdsRaw = row.clinicIds?.trim() ?? '';
    const clinicIdList = clinicIdsRaw
      ? clinicIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (!canAccessAll && clinicIdList.length === 0) {
      errors.push('clinicIds zorunludur (canAccessAllClinics=true değilse)');
    } else {
      for (const cId of clinicIdList) {
        if (!accessibleIds.includes(cId)) {
          errors.push(`clinicId erişilemez veya bu organizasyona ait değil: ${cId}`);
        }
      }
    }

    // Şifre
    const password = row.password?.trim() ?? '';
    if (password && password.length < 8) {
      errors.push('Şifre en az 8 karakter olmalıdır');
    }

    if (errors.length > 0) {
      results.push({ rowNumber, status: 'invalid', errors });
    } else {
      const finalPassword = password || generateTempPassword();
      if (!password) {
        tempPasswords.set(rowNumber, finalPassword);
      }

      results.push({
        rowNumber,
        status: 'valid',
        data: {
          firstName: row.firstName!.trim(),
          lastName: row.lastName!.trim(),
          email,
          role,
          clinicIds: clinicIdList,
          phone: row.phone?.trim() || undefined,
          password: finalPassword,
          canAccessAllClinics: canAccessAll,
        },
      });
    }
  }

  return { results, tempPasswords };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/users/import-preview
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/users/import-preview',
  authorize(IMPORT_ROLES),
  handleExcelUpload,
  async (req: AuthRequest, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const user = req.user!;
    const orgId = user.organizationId;

    try {
      const accessibleIds = await getAccessibleClinicIds(user);
      const { rows } = await parseExcelFile(file.buffer, ['firstName', 'lastName', 'email', 'role']);

      if (rows.length === 0) return res.status(400).json({ error: 'Dosyada satır bulunamadı' });
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ error: `En fazla ${MAX_IMPORT_ROWS} satır içe aktarılabilir` });
      }

      const { results } = await validateUserRows(rows, orgId, accessibleIds, user.normalizedRole);

      const validCount = results.filter((r) => r.status === 'valid').length;
      const invalidCount = results.filter((r) => r.status === 'invalid').length;

      res.json({
        totalRows: rows.length,
        validRows: validCount,
        invalidRows: invalidCount,
        rows: results,
      });
    } catch (err: any) {
      console.error('[users/import-preview]', err?.message);
      res.status(500).json({ error: 'Dosya işlenemedi' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/users/import-confirm
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/users/import-confirm',
  authorize(IMPORT_ROLES),
  handleExcelUpload,
  async (req: AuthRequest, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const user = req.user!;
    const orgId = user.organizationId;

    try {
      const accessibleIds = await getAccessibleClinicIds(user);
      const { rows } = await parseExcelFile(file.buffer, ['firstName', 'lastName', 'email', 'role']);

      if (rows.length === 0) return res.status(400).json({ error: 'Dosyada satır bulunamadı' });
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ error: `En fazla ${MAX_IMPORT_ROWS} satır içe aktarılabilir` });
      }

      const { results, tempPasswords } = await validateUserRows(rows, orgId, accessibleIds, user.normalizedRole);

      const validRows = results.filter(
        (r): r is Extract<ImportRowResult, { status: 'valid' }> => r.status === 'valid'
      );
      const skippedRows = results.filter((r) => r.status === 'invalid');

      const created: any[] = [];
      const skipped: any[] = [...skippedRows];

      // Plan kullanıcı limiti — organizasyon genelinde kontrol
      for (const row of validRows) {
        try {
          const data = row.data;
          const primaryClinicId = (data.clinicIds as string[])[0] ?? user.clinicId;

          const passwordHash = await bcrypt.hash(data.password as string, 12);

          const newUser = await prisma.user.create({
            data: {
              organizationId: orgId,
              clinicId: primaryClinicId,
              firstName: data.firstName as string,
              lastName: data.lastName as string,
              email: data.email as string,
              phone: (data.phone as string) ?? null,
              role: data.role as string,
              passwordHash,
              isActive: true,
              emailVerifiedAt: new Date(),
              canAccessAllClinics: (data.canAccessAllClinics as boolean) ?? false,
              defaultClinicId: primaryClinicId,
            },
            select: {
              id: true, firstName: true, lastName: true, email: true, role: true,
            },
          });

          // UserClinic bağlantıları oluştur
          const clinicIds = data.clinicIds as string[];
          if (clinicIds.length > 0) {
            await prisma.userClinic.createMany({
              data: clinicIds.map((cId) => ({
                userId: newUser.id,
                clinicId: cId,
                role: data.role as string,
              })),
              skipDuplicates: true,
            });
          }

          await logActivity({
            clinicId: primaryClinicId,
            userId: user.id,
            entityType: 'user',
            entityId: newUser.id,
            action: 'created',
            description: `Excel içe aktarma ile kullanıcı oluşturuldu: ${newUser.email}`,
          });

          const resultEntry: any = {
            rowNumber: row.rowNumber,
            id: newUser.id,
            email: newUser.email,
            name: `${newUser.firstName} ${newUser.lastName}`,
          };

          // Geçici şifreler yalnızca bir kez döndürülür
          if (tempPasswords.has(row.rowNumber)) {
            resultEntry.temporaryPassword = tempPasswords.get(row.rowNumber);
          }

          // Davet e-postası gönderimi başarısız olsa bile satır "created" sayılmalı
          resultEntry.invitationEmailSent = false;
          try {
            const appBaseUrl = (process.env.APP_BASE_URL ?? 'https://app.noramedi.com').replace(/\/$/, '');
            const { rawToken } = await createPasswordResetToken(newUser.id);
            const resetUrl = `${appBaseUrl}/reset-password?token=${rawToken}`;
            const clinic = await prisma.clinic.findUnique({ where: { id: primaryClinicId }, select: { name: true } });
            const { subject, html, text } = buildStaffOnboardingEmail({
              firstName: newUser.firstName,
              clinicName: clinic?.name ?? 'NoraMedi',
              resetUrl,
              expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
            });
            const mailResult = await sendMail({ to: newUser.email, subject, html, text });
            resultEntry.invitationEmailSent = mailResult.sent;
            if (!mailResult.sent) {
              console.warn(`[users/import-confirm] invitation email not sent for user ${newUser.id}: ${mailResult.reason}`);
            }
          } catch (mailErr: any) {
            console.warn(`[users/import-confirm] invitation email failed for user ${newUser.id}: ${mailErr?.message}`);
          }

          created.push(resultEntry);
        } catch (rowErr: any) {
          skipped.push({
            rowNumber: row.rowNumber,
            status: 'invalid',
            errors: ['Veritabanı hatası'],
          });
        }
      }

      const hasTemporaryPasswords = created.some((c) => c.temporaryPassword);
      const hasFailedInvitations = created.some((c) => !c.invitationEmailSent);

      res.json({
        imported: created.length,
        skipped: skipped.length,
        createdUsers: created,
        skippedRows: skipped,
        hasTemporaryPasswords,
        hasFailedInvitations,
        warning: hasTemporaryPasswords
          ? 'Geçici şifreler yalnızca bir kez gösterilir. Lütfen kaydedin.'
          : undefined,
      });
    } catch (err: any) {
      console.error('[users/import-confirm]', err?.message);
      res.status(500).json({ error: 'İçe aktarma başarısız' });
    }
  }
);

export default router;
