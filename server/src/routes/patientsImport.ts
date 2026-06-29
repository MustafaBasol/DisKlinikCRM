/**
 * patientsImport.ts — Hasta Excel içe aktarma endpoint'leri (Sprint 22)
 *
 * GET  /api/patients/import-template  → .xlsx şablon indir
 * POST /api/patients/import-preview   → doğrulama önizleme (DB yazma yok)
 * POST /api/patients/import-confirm   → geçerli satırları içe aktar
 *
 * İzin verilen roller: OWNER, ORG_ADMIN, CLINIC_MANAGER, RECEPTIONIST
 */

import express, { Response, NextFunction } from 'express';
import multer from 'multer';
import { authorize, AuthRequest } from '../middleware/auth.js';
import prisma from '../db.js';
import { logActivity } from '../utils/activity.js';
import { getAccessibleClinicIds } from '../utils/clinicScope.js';
import {
  buildPatientTemplate,
  parseExcelFile,
  ImportRowResult,
  MAX_IMPORT_ROWS,
  MAX_FILE_SIZE_BYTES,
} from '../utils/excelImport.js';

const router = express.Router();

// ── Multer: bellek içi (geçici dosya saklanmaz) ───────────────────────────────
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
const IMPORT_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'RECEPTIONIST'];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/patients/import-template
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/patients/import-template',
  authorize(IMPORT_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const accessibleIds = await getAccessibleClinicIds(req.user!);
      const clinics = await prisma.clinic.findMany({
        where: { id: { in: accessibleIds }, organizationId: req.user!.organizationId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const templateClinicId = req.query.clinicId as string | undefined;
      const buf = await buildPatientTemplate(clinics, templateClinicId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="hasta-import-sablonu.xlsx"');
      res.send(buf);
    } catch (err: any) {
      console.error('[patients/import-template]', err?.message);
      res.status(500).json({ error: 'Şablon oluşturulamadı' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Ortak: satır doğrulama mantığı
// ─────────────────────────────────────────────────────────────────────────────
interface PatientRow {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  gender?: string;
  address?: string;
  city?: string;
  notes?: string;
  clinicId?: string;
  source?: string;
}

const VALID_GENDERS = new Set(['male', 'female', 'other', '']);
const VALID_SOURCES = new Set(['walk_in', 'referral', 'online', 'social_media', 'other', '']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function validatePatientRows(
  rows: Record<string, string>[],
  orgId: string,
  accessibleIds: string[],
  selectedClinicId: string | undefined,
): Promise<{ results: ImportRowResult[]; existingPhones: Set<string>; existingEmails: Set<string> }> {
  // Organizasyon içindeki mevcut telefon ve email'leri önceden yükle
  const [existingByPhone, existingByEmail] = await Promise.all([
    prisma.patient.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: { phone: true },
    }),
    prisma.patient.findMany({
      where: { organizationId: orgId, deletedAt: null, email: { not: null } },
      select: { email: true },
    }),
  ]);

  const existingPhones = new Set(existingByPhone.map((p: { phone: string | null }) => (p.phone ?? '').trim()));
  const existingEmails = new Set(
    existingByEmail.map((p: { email: string | null }) => (p.email ?? '').toLowerCase())
  );

  // Batch doğrulama sırasında tekrar edenleri takip et
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as PatientRow;
    const rowNumber = i + 2; // Excel satır numarası (başlık=1)
    const errors: string[] = [];

    // Zorunlu alanlar
    if (!row.firstName?.trim()) errors.push('firstName zorunludur');
    if (!row.lastName?.trim()) errors.push('lastName zorunludur');
    const phone = row.phone?.trim() ?? '';
    if (!phone) {
      errors.push('phone zorunludur');
    } else {
      if (existingPhones.has(phone)) errors.push(`Bu telefon zaten kayıtlı: ${phone}`);
      if (seenPhones.has(phone)) errors.push(`Bu telefon dosyada tekrar ediyor: ${phone}`);
      seenPhones.add(phone);
    }

    // E-posta
    const email = row.email?.trim().toLowerCase() ?? '';
    if (email) {
      if (!EMAIL_RE.test(email)) errors.push('E-posta formatı geçersiz');
      else {
        if (existingEmails.has(email)) errors.push(`Bu e-posta zaten kayıtlı: ${email}`);
        if (seenEmails.has(email)) errors.push(`Bu e-posta dosyada tekrar ediyor: ${email}`);
        seenEmails.add(email);
      }
    }

    // birthDate
    const birthDate = row.birthDate?.trim() ?? '';
    if (birthDate) {
      const d = new Date(birthDate);
      if (isNaN(d.getTime())) errors.push(`birthDate formatı geçersiz: ${birthDate}`);
    }

    // gender
    const gender = row.gender?.trim().toLowerCase() ?? '';
    if (!VALID_GENDERS.has(gender)) errors.push(`gender geçersiz: ${row.gender} (male/female/other)`);

    // source
    const source = row.source?.trim().toLowerCase() ?? '';
    if (!VALID_SOURCES.has(source)) errors.push(`source geçersiz: ${row.source}`);

    // clinicId çözümle
    let resolvedClinicId: string | undefined;
    const clinicIdFromRow = row.clinicId?.trim() ?? '';
    if (clinicIdFromRow) {
      // Organizasyona ait mi ve erişilebilir mi?
      if (!accessibleIds.includes(clinicIdFromRow)) {
        errors.push(`clinicId erişilemez veya bu organizasyona ait değil: ${clinicIdFromRow}`);
      } else {
        resolvedClinicId = clinicIdFromRow;
      }
    } else if (selectedClinicId && selectedClinicId !== 'all') {
      resolvedClinicId = selectedClinicId;
    } else {
      errors.push('clinicId zorunludur (tüm şubeler görünümünde)');
    }

    if (errors.length > 0) {
      results.push({ rowNumber, status: 'invalid', errors });
    } else {
      results.push({
        rowNumber,
        status: 'valid',
        data: {
          firstName: row.firstName!.trim(),
          lastName: row.lastName!.trim(),
          phone,
          email: email || undefined,
          birthDate: birthDate ? new Date(birthDate).toISOString() : undefined,
          gender: gender || undefined,
          address: row.address?.trim() || undefined,
          city: row.city?.trim() || undefined,
          notes: row.notes?.trim() || undefined,
          clinicId: resolvedClinicId,
          source: source || undefined,
        },
      });
    }
  }

  return { results, existingPhones, existingEmails };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/patients/import-preview
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/patients/import-preview',
  authorize(IMPORT_ROLES),
  handleExcelUpload,
  async (req: AuthRequest, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const orgId = req.user!.organizationId;
    const selectedClinicId = req.query.clinicId as string | undefined;

    try {
      const accessibleIds = await getAccessibleClinicIds(req.user!);

      const { rows } = await parseExcelFile(
        file.buffer,
        ['firstName', 'lastName', 'phone']
      );

      if (rows.length === 0) return res.status(400).json({ error: 'Dosyada satır bulunamadı' });
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ error: `En fazla ${MAX_IMPORT_ROWS} satır içe aktarılabilir` });
      }

      const { results } = await validatePatientRows(rows, orgId, accessibleIds, selectedClinicId);

      const validCount = results.filter((r) => r.status === 'valid').length;
      const invalidCount = results.filter((r) => r.status === 'invalid').length;

      res.json({
        totalRows: rows.length,
        validRows: validCount,
        invalidRows: invalidCount,
        rows: results,
      });
    } catch (err: any) {
      console.error('[patients/import-preview]', err?.message);
      res.status(500).json({ error: 'Dosya işlenemedi' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/patients/import-confirm
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/patients/import-confirm',
  authorize(IMPORT_ROLES),
  handleExcelUpload,
  async (req: AuthRequest, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: 'Dosya yüklenmedi' });

    const user = req.user!;
    const orgId = user.organizationId;
    const selectedClinicId = req.query.clinicId as string | undefined;

    try {
      const accessibleIds = await getAccessibleClinicIds(user);

      const { rows } = await parseExcelFile(file.buffer, ['firstName', 'lastName', 'phone']);
      if (rows.length === 0) return res.status(400).json({ error: 'Dosyada satır bulunamadı' });
      if (rows.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({ error: `En fazla ${MAX_IMPORT_ROWS} satır içe aktarılabilir` });
      }

      // Plan hasta limiti kontrolü — basit: klinik bazlı sayı kontrolü
      // Her satır için ayrı ayrı yapmak yerine toplam geçerli satır sayısını kontrol et
      const { results } = await validatePatientRows(rows, orgId, accessibleIds, selectedClinicId);

      const validRows = results.filter((r): r is Extract<ImportRowResult, { status: 'valid' }> => r.status === 'valid');
      const skippedRows = results.filter((r) => r.status === 'invalid');

      const created: any[] = [];
      const skipped: any[] = [...skippedRows];

      for (const row of validRows) {
        try {
          // Plan limiti kontrolü (klinik bazlı)
          const clinicId = row.data.clinicId as string;
          const clinic = await prisma.clinic.findUnique({
            where: { id: clinicId },
            select: { maxPatients: true },
          });
          const patientCount = await prisma.patient.count({ where: { clinicId, deletedAt: null } });
          if (clinic && patientCount >= clinic.maxPatients) {
            skipped.push({
              rowNumber: row.rowNumber,
              status: 'invalid',
              errors: [`${clinicId} kliniği hasta limitine ulaştı`],
            });
            continue;
          }

          const patient = await prisma.patient.create({
            data: {
              organizationId: orgId,
              clinicId,
              firstName: row.data.firstName,
              lastName: row.data.lastName,
              phone: row.data.phone,
              email: row.data.email ?? null,
              dateOfBirth: row.data.birthDate ? new Date(row.data.birthDate) : null,
              address: row.data.address ?? null,
              city: row.data.city ?? null,
              notes: row.data.notes ?? null,
              source: row.data.source ?? null,
            },
          });

          await logActivity({
            clinicId,
            userId: user.id,
            entityType: 'patient',
            entityId: patient.id,
            action: 'created',
            description: `Excel içe aktarma ile oluşturuldu: ${patient.firstName} ${patient.lastName}`,
          });

          created.push({ rowNumber: row.rowNumber, id: patient.id, name: `${patient.firstName} ${patient.lastName}` });
        } catch (rowErr: any) {
          console.error(`[patients/import-confirm] row ${row.rowNumber} org=${orgId}:`, rowErr?.code, rowErr?.meta);
          let errMsg = 'Beklenmeyen bir hata oluştu';
          if (rowErr?.code === 'P2002') {
            const fields = (rowErr?.meta?.target as string[] | undefined) ?? [];
            if (fields.includes('phone')) {
              errMsg = `Bu telefon numarası zaten kayıtlı: ${row.data.phone}`;
            } else if (fields.includes('email')) {
              errMsg = `Bu e-posta adresi zaten kayıtlı: ${row.data.email}`;
            } else {
              errMsg = 'Bu kayıt zaten mevcut (tekil alan çakışması)';
            }
          } else if (rowErr?.code === 'P2003') {
            errMsg = 'Geçersiz klinik veya organizasyon referansı';
          } else if (rowErr?.code === 'P2025') {
            errMsg = 'İlgili kayıt bulunamadı';
          }
          skipped.push({
            rowNumber: row.rowNumber,
            status: 'invalid',
            errors: [errMsg],
          });
        }
      }

      res.json({
        imported: created.length,
        skipped: skipped.length,
        createdPatients: created,
        skippedRows: skipped,
      });
    } catch (err: any) {
      console.error('[patients/import-confirm]', err?.message);
      res.status(500).json({ error: 'İçe aktarma başarısız' });
    }
  }
);

export default router;
