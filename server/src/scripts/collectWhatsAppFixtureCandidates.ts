/**
 * collectWhatsAppFixtureCandidates.ts
 *
 * Veritabanındaki gerçek WhatsApp mesajlarını tarayarak kural tabanlı fallback
 * sınıflandırıcısının null döndürdüğü (sınıflandıramadığı) veya düşük güven
 * puanıyla sınıflandırdığı mesajları toplar.
 *
 * Mesaj metni normalize edilerek yinelemeler gruplandırılır. Sonuç, insan
 * incelemesine sunulmak üzere TypeScript fixture bloğu olarak ekrana veya
 * bir dosyaya yazılır.
 *
 * Bu script YALNIZCA okuma yapar. Veritabanına yazma işlemi yoktur.
 * Hasta adı veya telefon numarası hiçbir çıktıya eklenmez.
 *
 * Kullanım:
 *   cd server
 *   dotenv -e .env -- npx tsx src/scripts/collectWhatsAppFixtureCandidates.ts
 *   dotenv -e .env -- npx tsx src/scripts/collectWhatsAppFixtureCandidates.ts --days 30
 *   dotenv -e .env -- npx tsx src/scripts/collectWhatsAppFixtureCandidates.ts --clinic CLINIC_ID
 *   dotenv -e .env -- npx tsx src/scripts/collectWhatsAppFixtureCandidates.ts --min-count 2 --output src/tests/whatsappFixtureCandidates.generated.ts
 *
 * Bayraklar:
 *   --days N          Kaç günlük mesaja bakılacak (varsayılan: 14)
 *   --clinic ID       Yalnızca belirtilen klinik ID'si taransın
 *   --min-count N     Bir mesajın çıktıya girmesi için kaç kez geçmesi gerektiği (varsayılan: 1)
 *   --max-messages N  Taranacak maksimum mesaj sayısı (varsayılan: 2000)
 *   --output PATH     Çıktı dosya yolu; belirtilmezse stdout
 *   --confidence F    Bu değerin altındaki sınıflandırmalar da dahil edilir (varsayılan: 0.85)
 *
 * Çıktı nasıl kullanılır:
 *   1. Script çalıştırılır, üretilen TypeScript bloğu incelenir.
 *   2. Doğru intent/action eşleştiğinden emin olunan satırlar
 *      server/src/tests/whatsappAgentEvaluation.test.ts içindeki
 *      ilgili cases(...) bloğuna kopyalanır.
 *   3. npm run test:agent komutu ile regression testi yapılır.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { buildFallbackWhatsAppAgentDecision } from '../services/whatsappConversationAgent.js';
import type { WhatsAppAgentAction, WhatsAppAgentIntent } from '../services/whatsappAgentSchema.js';

const prisma = new PrismaClient();

// ── Argüman ayrıştırma ────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const getFlag = (name: string, fallback: string): string => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const days = parseInt(getFlag('days', '14'), 10);
const clinicId = getFlag('clinic', '');
const minCount = parseInt(getFlag('min-count', '1'), 10);
const maxMessages = parseInt(getFlag('max-messages', '2000'), 10);
const outputPath = getFlag('output', '');
const confidenceThreshold = parseFloat(getFlag('confidence', '0.85'));

// ── Türkçe normalize fonksiyonu (agent ile aynı) ─────────────────────────────

const normalizeTurkishSearchText = (value: string) => value.trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/\s+/g, ' ')
  .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
  .replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ── Minimal agent args ────────────────────────────────────────────────────────

const makeMinimalArgs = (message: string) => ({
  latestMessage: message,
  customerName: null,
  currentIntent: null as string | null,
  currentStep: null as string | null,
  selectedAppointmentTypeName: null,
  selectedDate: null,
  services: [],
  recentMessages: [],
  clinicFacts: {
    clinicName: '',
    timezone: 'Europe/Istanbul',
    hasAddress: false,
    hasPhone: false,
    hasEmail: false,
    hasWebsite: false,
    doctorCountKnown: false,
    doctorCount: null,
    workingHoursKnown: false,
  },
});

// ── Tip tanımları ─────────────────────────────────────────────────────────────

type CandidateGroup = {
  representative: string;       // İnsan okunabilir asıl metin
  normalizedKey: string;        // Gruplama anahtarı
  count: number;                // Üretimde kaç kez göründü
  intent: WhatsAppAgentIntent | 'unclassified';
  action: WhatsAppAgentAction | null;
  confidence: number | null;
  reason: 'null_result' | 'low_confidence';
};

// ── Ana logic ─────────────────────────────────────────────────────────────────

const run = async () => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.error(`[collect] Tarih aralığı: son ${days} gün (${since.toISOString()})`);
  console.error(`[collect] Maksimum mesaj: ${maxMessages}`);
  if (clinicId) console.error(`[collect] Klinik filtresi: ${clinicId}`);
  console.error(`[collect] Confidence eşiği: ${confidenceThreshold}`);

  const messages = await prisma.whatsAppConversationMessage.findMany({
    where: {
      direction: 'incoming',
      createdAt: { gte: since },
      ...(clinicId ? { clinicId } : {}),
    },
    select: { text: true },
    orderBy: { createdAt: 'desc' },
    take: maxMessages,
  });

  console.error(`[collect] ${messages.length} gelen mesaj bulundu.`);

  // Normalize edilmiş metne göre grupla — aynı mesajı bir kez sınıflandır
  const grouped = new Map<string, { text: string; count: number }>();
  for (const { text } of messages) {
    if (!text?.trim()) continue;
    const key = normalizeTurkishSearchText(text);
    if (key.length < 2) continue;
    const entry = grouped.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      grouped.set(key, { text, count: 1 });
    }
  }

  console.error(`[collect] ${grouped.size} benzersiz mesaj normalizasyonu.`);

  const candidates: CandidateGroup[] = [];

  for (const [normalizedKey, { text, count }] of grouped) {
    if (count < minCount) continue;

    const decision = buildFallbackWhatsAppAgentDecision(makeMinimalArgs(text));

    if (!decision) {
      candidates.push({
        representative: text,
        normalizedKey,
        count,
        intent: 'unclassified',
        action: null,
        confidence: null,
        reason: 'null_result',
      });
    } else if (decision.confidence < confidenceThreshold) {
      candidates.push({
        representative: text,
        normalizedKey,
        count,
        intent: decision.intent,
        action: decision.action,
        confidence: decision.confidence,
        reason: 'low_confidence',
      });
    }
  }

  console.error(`[collect] ${candidates.length} aday mesaj bulundu.`);

  if (candidates.length === 0) {
    console.error('[collect] Eklenecek aday yok. Son ${days} günde tüm mesajlar sınıflandırılabildi.');
    await prisma.$disconnect();
    return;
  }

  // Önce üretim sıklığına göre sırala
  candidates.sort((a, b) => b.count - a.count);

  // ── Çıktı üret ────────────────────────────────────────────────────────────

  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * whatsappFixtureCandidates.generated.ts`);
  lines.push(` *`);
  lines.push(` * Bu dosya collectWhatsAppFixtureCandidates.ts tarafından ${now} tarihinde üretildi.`);
  lines.push(` * Son ${days} günlük üretim verisi tarandı — ${candidates.length} aday mesaj.`);
  lines.push(` *`);
  lines.push(` * NASIL KULLANILIR:`);
  lines.push(` *   1. Her satırı incele. intent ve action sütunlarını onayla.`);
  lines.push(` *   2. Doğru eşleşmeleri whatsappAgentEvaluation.test.ts içindeki`);
  lines.push(` *      ilgili cases(...) bloğuna kopyala.`);
  lines.push(` *   3. npm run test:agent ile kontrol et.`);
  lines.push(` *   4. Bu dosyayı commit etme — sadece review için üretildi.`);
  lines.push(` */`);
  lines.push('');

  // null_result grubunu (sınıflandırılamayan) önce yaz
  const nullResults = candidates.filter(c => c.reason === 'null_result');
  const lowConfidence = candidates.filter(c => c.reason === 'low_confidence');

  if (nullResults.length > 0) {
    lines.push(`// ────────────────────────────────────────────────────────────`);
    lines.push(`// SINIFLANDIRILAMAYAN MESAJLAR (fallback null döndü)`);
    lines.push(`// Bu mesajlar için doğru intent'i belirleyip aşağıdaki bloklara ekle.`);
    lines.push(`// ────────────────────────────────────────────────────────────`);
    lines.push('');

    for (const c of nullResults) {
      const escapedText = c.representative.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      lines.push(`  // Üretimde ${c.count}x — intent: BELİRLENMEDİ, action: BELİRLENMEDİ`);
      lines.push(`  // { category: '???', message: '${escapedText}', intent: '???', action: '???' },`);
    }

    lines.push('');
  }

  if (lowConfidence.length > 0) {
    lines.push(`// ────────────────────────────────────────────────────────────`);
    lines.push(`// DÜŞÜK GÜVEN PUANLI MESAJLAR (confidence < ${confidenceThreshold})`);
    lines.push(`// Fallback bir intent buldu ama güveni düşük.`);
    lines.push(`// Önerilen intent/action doğruysa başındaki // işaretini kaldır.`);
    lines.push(`// ────────────────────────────────────────────────────────────`);
    lines.push('');

    // intent bazlı gruplama
    const byIntent = new Map<string, CandidateGroup[]>();
    for (const c of lowConfidence) {
      const key = c.intent;
      const list = byIntent.get(key) ?? [];
      list.push(c);
      byIntent.set(key, list);
    }

    for (const [intent, group] of byIntent) {
      lines.push(`  // --- ${intent} ---`);
      for (const c of group) {
        const escapedText = c.representative.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const action = c.action ?? 'unknown_safe_reply';
        const conf = c.confidence !== null ? c.confidence.toFixed(2) : '?';
        lines.push(`  // Üretimde ${c.count}x — confidence: ${conf}`);
        lines.push(`  // { category: '${intent}', message: '${escapedText}', intent: '${intent}', action: '${action}' },`);
      }
      lines.push('');
    }
  }

  const output = lines.join('\n');

  if (outputPath) {
    writeFileSync(outputPath, output, 'utf-8');
    console.error(`[collect] Çıktı yazıldı: ${outputPath}`);
    console.error(`[collect] İnceledikten sonra ilgili satırları whatsappAgentEvaluation.test.ts dosyasına kopyala.`);
  } else {
    process.stdout.write(output + '\n');
  }

  await prisma.$disconnect();
};

run().catch(async (error) => {
  console.error('[collect] Hata:', error);
  await prisma.$disconnect();
  process.exit(1);
});
