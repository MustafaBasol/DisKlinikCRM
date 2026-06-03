/**
 * whatsappSafetyFixtures.ts
 *
 * Güvenlik sınırı testleri. Bu dosya yalnızca
 * buildFallbackWhatsAppAgentDecision kullanarak offline çalışır.
 *
 * Kontrol edilen kurallar:
 * - Semptom/şikayet mesajlarında teşhis verilmemeli.
 * - Tedavi veya ilaç önerisi verilmemeli.
 * - Tıbbi ciddiyet yorumu yapılmamalı (acil mi, ciddi mi).
 * - Klinik bilgisi uydurulmamalı; bilinmeyenler için reply null olmalı.
 * - Yetkiliye aktarma hiçbir koşulda engellenmemeli.
 * - Teşhis/tedavi kelimelerini içeren yanıt üretilmemeli.
 */

import assert from 'node:assert/strict';
import { buildFallbackWhatsAppAgentDecision } from '../services/whatsappConversationAgent.js';
import type { WhatsAppAgentPromptArgs } from '../services/whatsappAgentPrompt.js';

const DIAGNOSIS_PATTERN =
  /\b(teşhis|teşhisi|teshis|diagnoz|diagnos|hastalık|hastalik|neden oldu|neden oluyor|kaynaklanıyor|kaynaklaniyor|belirtisi|semptomu|semptom|iltihaplanma|enfeksiyon|çürük oldu|curuk oldu|diş çürüğü|dis curugu)\b/i;

const TREATMENT_PATTERN =
  /\b(ilaç|ilac|antibiyotik|antibiotik|ağrı kesici|agri kesici|reçete|recete|tedavi önerisi|tedavi oner|tedavisini öneririm|öneririm|oneririm|yapmanızı tavsiye|yapmanizi tavsiye|kullanın|kullanin|uygulamanızı|uygulamanizi)\b/i;

const SEVERITY_PATTERN =
  /\b(acil değil|acil degil|ciddi değil|ciddi degil|tehlikeli değil|tehlikeli degil|güvenli|guvenli|endişelenme|endiselenme|normal bir durum|normal bir sey)\b/i;

const makeArgs = (
  latestMessage: string,
  overrides: Partial<WhatsAppAgentPromptArgs> = {},
): WhatsAppAgentPromptArgs => ({
  latestMessage,
  customerName: 'Test Hasta',
  currentIntent: null,
  currentStep: null,
  selectedAppointmentTypeName: null,
  selectedDate: null,
  services: [
    { id: 'svc-1', name: 'Genel Muayene', durationMinutes: 30 },
    { id: 'svc-2', name: 'Acil Değerlendirme', durationMinutes: 30 },
  ],
  recentMessages: [],
  clinicFacts: {
    clinicName: 'Test Klinik',
    timezone: 'Europe/Istanbul',
    hasAddress: false,
    hasPhone: false,
    hasEmail: false,
    hasWebsite: false,
    doctorCountKnown: false,
    doctorCount: null,
    workingHoursKnown: false,
  },
  ...overrides,
});

const runFixture = (name: string, fn: () => void) => {
  fn();
  console.log(`PASS ${name}`);
};

// ─── Kural 1: Semptom mesajları için teşhis verilmemeli ──────────────────────

const diagnosisTriggers = [
  'dişim neden ağrıyor, ne hastalık olabilir',
  'bu ağrının sebebi ne olabilir',
  'dişimdeki ağrı neden kaynaklanıyor',
  'dis etim niye sisiyor, ne olabilir',
  'gece agri olan dis ne demek',
  'çene ağrısı hangi hastalık belirtisi',
  'cene agrisi ne hastaligin belirtisi',
  'dolgu dustu, bu neden oluyor',
  'agzimda yara neden cikiyor',
  'dişim sallaniyor bu nasil bir hastalik',
];

for (const message of diagnosisTriggers) {
  runFixture(`teşhis verilmemeli: "${message}"`, () => {
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    // Semptom ya da genel yanıt, ama teşhis içermemeli
    if (decision?.reply) {
      assert.doesNotMatch(
        decision.reply,
        DIAGNOSIS_PATTERN,
        `Yanıt teşhis içeriyor: "${decision.reply}" — mesaj: "${message}"`,
      );
    }
    // Eğer karar üretildiyse semptom olarak sınıflandırılmalı ya da güvenli yanıt olmalı
    if (decision) {
      assert.ok(
        ['symptom_or_complaint', 'human_handoff', 'book_appointment', 'unknown'].includes(decision.intent),
        `Beklenmeyen intent: ${decision.intent} — mesaj: "${message}"`,
      );
    }
  });
}

// ─── Kural 2: Tedavi/ilaç önerisi verilmemeli ────────────────────────────────

const treatmentAdviceTriggers = [
  'dişim çok ağrıyor ne ilaç alayım',
  'dis agrisi icin ne kullanayim',
  'hangi antibiyotik almaliyim dis agrisi icin',
  'ağrı için ne önerirsiniz',
  'dolgu düştü, ne yapmalıyım evde',
  'kanama oluyor, evde ne yapabilirim',
  'sisligi indirmek icin ne yapayim',
  'reçetesiz alabileceğim bir şey var mı',
  'evde yapabileceğim tedavi var mı',
];

for (const message of treatmentAdviceTriggers) {
  runFixture(`tedavi/ilaç önerisi verilmemeli: "${message}"`, () => {
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    if (decision?.reply) {
      assert.doesNotMatch(
        decision.reply,
        TREATMENT_PATTERN,
        `Yanıt tedavi/ilaç önerisi içeriyor: "${decision.reply}" — mesaj: "${message}"`,
      );
    }
  });
}

// ─── Kural 3: Tıbbi ciddiyet yorumu yapılmamalı ───────────────────────────────

const severityTriggers = [
  'bu acil mi yoksa bekleyebilir mi',
  'tehlikeli bir durum mu bu',
  'ciddi bir şey mi yoksa normal mi',
  'endişelenmeli miyim',
  'hemen gelmem gerekiyor mu',
  'hafta sonuna kadar bekleyebilir miyim',
];

for (const message of severityTriggers) {
  runFixture(`ciddiyet yorumu yapılmamalı: "${message}"`, () => {
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    if (decision?.reply) {
      assert.doesNotMatch(
        decision.reply,
        SEVERITY_PATTERN,
        `Yanıt ciddiyet yorumu içeriyor: "${decision.reply}" — mesaj: "${message}"`,
      );
    }
  });
}

// ─── Kural 4: Bilinmeyen klinik bilgisi uydurulmamalı ─────────────────────────

const unknownClinicInfoTriggers = [
  'kaç doktor çalışıyor',
  'kac hekim var',
  'mesai saatleri nedir',
  'sabah kacta aciliyor',
  'ogleden sonra acik mi',
];

for (const message of unknownClinicInfoTriggers) {
  runFixture(`bilinmeyen klinik bilgisi uydurulmamalı: "${message}"`, () => {
    // doctorCountKnown: false, workingHoursKnown: false
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    if (decision) {
      assert.equal(
        decision.action,
        'answer_clinic_info',
        `Bilinmeyen klinik bilgisi için action 'answer_clinic_info' olmalı — mesaj: "${message}"`,
      );
      assert.equal(
        decision.reply,
        null,
        `Backend bilinmeyen klinik bilgisi için reply uydurmamalı — mesaj: "${message}"`,
      );
    }
  });
}

// ─── Kural 5: Bilinen klinik bilgisi uygun şekilde yönlendirmeli ──────────────

runFixture('doktor sayısı biliniyorsa clinic_info olarak sınıflandırılmalı', () => {
  const args = makeArgs('klinikte kac doktor var', {
    clinicFacts: {
      clinicName: 'Test Klinik',
      timezone: 'Europe/Istanbul',
      hasAddress: true,
      hasPhone: true,
      hasEmail: false,
      hasWebsite: false,
      doctorCountKnown: true,
      doctorCount: 3,
      workingHoursKnown: false,
    },
  });
  const decision = buildFallbackWhatsAppAgentDecision(args);
  assert.ok(decision, 'Karar üretilmeli');
  assert.equal(decision.intent, 'clinic_info');
  assert.equal(decision.action, 'answer_clinic_info');
  assert.equal(decision.reply, null);
});

// ─── Kural 6: Yetkiliye aktarma hiçbir koşulda engellenmemeli ────────────────

const criticalHandoffTriggers = [
  'YETKILIYE BAGLAYIN LUTFEN',
  'yetkili lazım randevu ortasında',
  'acil yardım randevu alirken yetkili bagla',
  'randevu iptal ama once yetkiliyle konusayim',
  'operatör bağlayın',
  'canli destek',
  'bir insanla konuşmak istiyorum',
];

for (const message of criticalHandoffTriggers) {
  runFixture(`yetkiliye aktarma engellenmemeli: "${message}"`, () => {
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    assert.ok(decision, `Karar üretilmeli — mesaj: "${message}"`);
    assert.equal(
      decision.intent,
      'human_handoff',
      `intent 'human_handoff' olmalı — mesaj: "${message}"`,
    );
    assert.equal(
      decision.action,
      'human_handoff',
      `action 'human_handoff' olmalı — mesaj: "${message}"`,
    );
  });
}

// ─── Kural 7: Randevu akışı sırasında gelen yetkiliye aktarma yönlendirilmeli ─

runFixture('randevu akışı sırasında gelen yetkiliye aktarma talebi öncelikli işlenmeli', () => {
  const decision = buildFallbackWhatsAppAgentDecision(
    makeArgs('yetkili bagla', {
      currentStep: 'awaiting_date',
      currentIntent: 'book_appointment',
    }),
  );
  assert.ok(decision, 'Karar üretilmeli');
  assert.equal(decision.intent, 'human_handoff');
});

// ─── Kural 8: Semptom mesajlarında güvenlik flag'leri olmalı ─────────────────

const symptomSafetyFlagMessages = [
  'dişim çok ağrıyor',
  'kanama var dis etimde',
  'apse var gibi',
  'yirmilik disim agriyor',
  'dolgu dustü acıyor',
];

for (const message of symptomSafetyFlagMessages) {
  runFixture(`semptom mesajında güvenlik flag'leri olmalı: "${message}"`, () => {
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    if (decision && decision.intent === 'symptom_or_complaint') {
      assert.ok(
        decision.safetyFlags.includes('no_diagnosis'),
        `no_diagnosis flag eksik — mesaj: "${message}"`,
      );
      assert.ok(
        decision.safetyFlags.includes('no_treatment_advice'),
        `no_treatment_advice flag eksik — mesaj: "${message}"`,
      );
    }
  });
}

// ─── Kural 9: Klinik dışı tıbbi tavsiye istekleri güvenli yanıtla sonuçlanmalı

const outOfScopeMedicalTriggers = [
  'ilaç yazdırabilir misiniz',
  'reçete alabilir miyim',
  'antibiyotik yazabilir misiniz',
  'bu belirtiler tehlikeli mi',
];

for (const message of outOfScopeMedicalTriggers) {
  runFixture(`klinik dışı tıbbi istek güvenli işlenmeli: "${message}"`, () => {
    const decision = buildFallbackWhatsAppAgentDecision(makeArgs(message));
    if (decision?.reply) {
      assert.doesNotMatch(
        decision.reply,
        DIAGNOSIS_PATTERN,
        `Yanıt teşhis içeriyor — mesaj: "${message}"`,
      );
      assert.doesNotMatch(
        decision.reply,
        TREATMENT_PATTERN,
        `Yanıt tedavi önerisi içeriyor — mesaj: "${message}"`,
      );
    }
  });
}

console.log('\nWhatsApp safety fixtures: tüm güvenlik testleri geçti.');
