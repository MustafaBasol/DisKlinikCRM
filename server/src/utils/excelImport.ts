/**
 * excelImport.ts — Excel şablon oluşturma ve satır ayrıştırma yardımcıları (Sprint 22)
 *
 * Kullanılan kütüphane: exceljs
 * Güvenlik: tüm hücreler string/sayı olarak alınır — formül yürütülmez.
 */

import ExcelJS from 'exceljs';

// ─── Sabitleri ────────────────────────────────────────────────────────────────
export const MAX_IMPORT_ROWS = 500;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// ─── Ortak tip ────────────────────────────────────────────────────────────────
export type ImportRowResult =
  | { rowNumber: number; status: 'valid'; data: Record<string, any> }
  | { rowNumber: number; status: 'invalid'; errors: string[] };

// ─── Yardımcı: hücre değerini güvenli string'e çevir ─────────────────────────
export function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  // RichText
  if (typeof value === 'object' && 'richText' in (value as any)) {
    return ((value as any).richText as any[]).map((rt: any) => rt.text ?? '').join('').trim();
  }
  // Hyperlink hücresi (Excel'in otomatik köprü yaptığı e-posta/URL alanları)
  if (typeof value === 'object' && 'text' in (value as any) && 'hyperlink' in (value as any)) {
    return cellToString((value as any).text);
  }
  // Formül hücresi — yalnızca sonucu al, formülü çalıştırma
  if (typeof value === 'object' && 'result' in (value as any)) {
    return cellToString((value as any).result);
  }
  return String(value).trim();
}

// ─── Hasta şablon oluşturucu ──────────────────────────────────────────────────
export async function buildPatientTemplate(clinics: { id: string; name: string }[], selectedClinicId?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aile Diş CRM';
  wb.created = new Date();

  // 1. Sayfa: Veri girişi
  const ws = wb.addWorksheet('Hastalar');
  ws.columns = [
    { header: 'firstName *', key: 'firstName', width: 18 },
    { header: 'lastName *', key: 'lastName', width: 18 },
    { header: 'phone *', key: 'phone', width: 18 },
    { header: 'email', key: 'email', width: 24 },
    { header: 'birthDate (YYYY-MM-DD)', key: 'birthDate', width: 22 },
    { header: 'gender (male/female/other)', key: 'gender', width: 24 },
    { header: 'address', key: 'address', width: 30 },
    { header: 'city', key: 'city', width: 16 },
    { header: 'notes', key: 'notes', width: 30 },
    { header: 'clinicId (isteğe bağlı)', key: 'clinicId', width: 36 },
    { header: 'source', key: 'source', width: 18 },
  ];

  // Başlık satırını biçimlendir
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ws.getRow(1).height = 22;

  // Örnek satır
  ws.addRow({
    firstName: 'Ayşe',
    lastName: 'Demir',
    phone: '+905551234567',
    email: 'ayse@ornek.com',
    birthDate: '1985-06-15',
    gender: 'female',
    address: 'Atatürk Cad. No:1',
    city: 'İstanbul',
    notes: '',
    clinicId: (selectedClinicId && selectedClinicId !== 'all') ? selectedClinicId : (clinics[0]?.id ?? ''),
    source: 'walk_in',
  });

  // 2. Sayfa: Açıklamalar
  const wsInfo = wb.addWorksheet('Talimatlar');
  wsInfo.getColumn(1).width = 70;
  const lines = [
    ['Hasta Excel Şablonu — Kullanım Talimatları'],
    [''],
    ['Zorunlu Alanlar'],
    ['  • firstName  — Ad (boş bırakılamaz)'],
    ['  • lastName   — Soyad (boş bırakılamaz)'],
    ['  • phone      — Telefon numarası (boş bırakılamaz)'],
    [''],
    ['İsteğe Bağlı Alanlar'],
    ['  • email      — Geçerli e-posta adresi'],
    ['  • birthDate  — YYYY-MM-DD formatında (örn. 1985-06-15)'],
    ['  • gender     — male / female / other'],
    ['  • address    — Açık adres'],
    ['  • city       — Şehir'],
    ['  • notes      — Notlar'],
    ['  • clinicId   — İsteğe bağlı: Şube UUID\'si. Seçili klinik varsa otomatik kullanılır. Tüm şubeler görünümündeyken zorunludur.'],
    ['  • source     — walk_in / referral / online / social_media / other'],
    [''],
    ['Kurallar'],
    ['  • Aynı organizasyonda aynı telefon numarası tekrar edemez'],
    ['  • Aynı organizasyonda aynı e-posta tekrar edemez'],
    ['  • clinicId boşsa ve seçili klinik varsa o klinik kullanılır'],
    ['  • clinicId "tüm şubeler" görünümündeyken zorunludur'],
    ['  • Maksimum 500 satır içe aktarılabilir'],
  ];
  lines.forEach(([text], i) => {
    const row = wsInfo.getRow(i + 1);
    row.getCell(1).value = text;
    if (i === 0) row.getCell(1).font = { bold: true, size: 13 };
    if (i === 2 || i === 7 || i === 17) row.getCell(1).font = { bold: true };
  });

  // 3. Sayfa: Şube listesi (dinamik)
  const wsClinics = wb.addWorksheet('Şubeler');
  wsClinics.columns = [
    { header: 'Şube Adı', key: 'name', width: 30 },
    { header: 'clinicId (UUID)', key: 'id', width: 38 },
  ];
  wsClinics.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });
  clinics.forEach((c) => wsClinics.addRow({ name: c.name, id: c.id }));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// Excel'de açılır liste olarak sunulan roller (en yüksek yetkili roller hariç)
export const USER_TEMPLATE_ROLE_OPTIONS = ['admin', 'doctor', 'receptionist', 'billing', 'assistant'];

// ─── Kullanıcı şablon oluşturucu ──────────────────────────────────────────────
export async function buildUserTemplate(clinics: { id: string; name: string }[], selectedClinicId?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aile Diş CRM';
  wb.created = new Date();

  const ws = wb.addWorksheet('Kullanıcılar');
  ws.columns = [
    { header: 'firstName *', key: 'firstName', width: 18 },
    { header: 'lastName *', key: 'lastName', width: 18 },
    { header: 'email *', key: 'email', width: 28 },
    { header: 'role *', key: 'role', width: 18 },
    { header: 'clinicIds (isteğe bağlı, virgülle ayrılmış UUID)', key: 'clinicIds', width: 40 },
    { header: 'phone', key: 'phone', width: 18 },
    { header: 'password (boşsa geçici üretilir)', key: 'password', width: 32 },
    { header: 'canAccessAllClinics (true/false)', key: 'canAccessAllClinics', width: 34 },
  ];

  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ws.getRow(1).height = 22;

  const exampleClinicId = (selectedClinicId && selectedClinicId !== 'all') ? selectedClinicId : (clinics[0]?.id ?? '');

  ws.addRow({
    firstName: 'Mehmet',
    lastName: 'Yılmaz',
    email: 'mehmet@klinik.com',
    role: 'doctor',
    clinicIds: exampleClinicId,
    phone: '+905559876543',
    password: '',
    canAccessAllClinics: 'false',
  });

  // role sütunu için açılır liste (data validation)
  const roleListFormula = `"${USER_TEMPLATE_ROLE_OPTIONS.join(',')}"`;
  for (let rowNum = 2; rowNum <= 200; rowNum++) {
    ws.getCell(`D${rowNum}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [roleListFormula],
      showErrorMessage: true,
      errorTitle: 'Geçersiz rol',
      error: `Lütfen listeden bir rol seçin: ${USER_TEMPLATE_ROLE_OPTIONS.join(', ')}`,
    };
  }

  // Açıklamalar
  const wsInfo = wb.addWorksheet('Talimatlar');
  wsInfo.getColumn(1).width = 70;
  const lines = [
    ['Kullanıcı Excel Şablonu — Kullanım Talimatları'],
    [''],
    ['Zorunlu Alanlar'],
    ['  • firstName  — Ad'],
    ['  • lastName   — Soyad'],
    ['  • email      — Geçerli ve benzersiz e-posta'],
    ['  • role       — admin / doctor / receptionist / billing / assistant (hücredeki açılır listeden seçilebilir)'],
    [''],
    ['İsteğe Bağlı Alanlar'],
    ['  • clinicIds            — Virgülle ayrılmış Şube UUID\'leri. Boşsa ve seçili şube varsa o şube kullanılır.'],
    ['  • phone                — Telefon numarası'],
    ['  • password             — Boşsa geçici şifre üretilir (yalnızca bir kez gösterilir)'],
    ['  • canAccessAllClinics  — true ise tüm şubelere erişim (yalnızca OWNER/ORG_ADMIN atayabilir)'],
    [''],
    ['Güvenlik Notları'],
    ['  • Şifreler minimum 8 karakter olmalıdır'],
    ['  • Geçici şifreler yalnızca içe aktarma sonuç ekranında gösterilir'],
    ['  • CLINIC_MANAGER rolü OWNER/ORG_ADMIN düzeyinde kullanıcı ekleyemez'],
    ['  • Mevcut e-postalar atlanır (üzerine yazılmaz)'],
    ['  • clinicIds boşsa, canAccessAllClinics=true değilse ve "tüm şubeler" görünümündeyse zorunludur'],
    ['  • Maksimum 500 satır içe aktarılabilir'],
  ];
  lines.forEach(([text], i) => {
    const row = wsInfo.getRow(i + 1);
    row.getCell(1).value = text;
    if (i === 0) row.getCell(1).font = { bold: true, size: 13 };
    if (i === 2 || i === 8 || i === 13) row.getCell(1).font = { bold: true };
  });

  // Şube referans listesi
  const wsClinics = wb.addWorksheet('Şubeler');
  wsClinics.columns = [
    { header: 'Şube Adı', key: 'name', width: 30 },
    { header: 'clinicId (UUID)', key: 'id', width: 38 },
  ];
  wsClinics.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  });
  clinics.forEach((c) => wsClinics.addRow({ name: c.name, id: c.id }));

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Excel dosyasını ayrıştır → satır dizisi ─────────────────────────────────
export async function parseExcelFile(
  buffer: Buffer,
  expectedHeaders: string[]
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel dosyası boş veya okunamadı');

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    // Başlıktan " *" ve parantez içi açıklamaları temizle
    const raw = cellToString(cell.value).replace(/\s*\*.*$/, '').replace(/\s*\(.*\).*$/, '').trim();
    headers.push(raw);
  });

  const rows: Record<string, string>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Başlık satırı
    const record: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      if (key) record[key] = cellToString(cell.value);
    });
    // Boş satırı atla
    const hasData = Object.values(record).some((v) => v !== '');
    if (hasData) rows.push(record);
  });

  return { headers, rows };
}
