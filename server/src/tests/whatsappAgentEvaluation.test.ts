import assert from 'node:assert/strict';
import { buildFallbackWhatsAppAgentDecision } from '../services/whatsappConversationAgent.js';
import type { WhatsAppAgentAction, WhatsAppAgentIntent } from '../services/whatsappAgentSchema.js';

type EvaluationCase = {
  category: string;
  message: string;
  intent: WhatsAppAgentIntent;
  action: WhatsAppAgentAction;
  currentStep?: string | null;
};

type UnknownCase = {
  category: 'unknown';
  message: string;
};

const services = [
  { id: 'svc-1', name: 'Diş Temizliği', durationMinutes: 30 },
  { id: 'svc-2', name: 'İmplant Muayenesi', durationMinutes: 60 },
  { id: 'svc-3', name: 'Genel Muayene', durationMinutes: 30 },
];

const makeAgentArgs = (message: string, currentStep?: string | null) => ({
  latestMessage: message,
  customerName: 'Ayşe Demir',
  currentIntent: currentStep ? 'book_appointment' : null,
  currentStep: currentStep ?? null,
  selectedAppointmentTypeName: null,
  selectedDate: null,
  services,
  recentMessages: [],
  clinicFacts: {
    clinicName: 'Diş Klinik',
    timezone: 'Europe/Istanbul',
    hasAddress: true,
    hasPhone: true,
    hasEmail: false,
    hasWebsite: false,
    doctorCountKnown: true,
    doctorCount: 3,
    workingHoursKnown: true,
    workingHoursDetail: 'closed_days_only' as const,
  },
});

const cases = (
  category: string,
  intent: WhatsAppAgentIntent,
  action: WhatsAppAgentAction,
  messages: string[],
  currentStep?: string | null,
): EvaluationCase[] => messages.map(message => ({
  category,
  message,
  intent,
  action,
  currentStep,
}));

const evaluationCases: EvaluationCase[] = [
  ...cases('human_handoff', 'human_handoff', 'human_handoff', [
    'yetklye bagla beni lutfen',
    'yetkiliyle grsmk istyrm',
    'temsilciye ulasmak istiyorum',
    'beni resepsiyon arasin',
    'doktorla konusabilir miyim',
    'canli destek var mi',
    'klinik ekibine iletir misiniz',
    'biriyle goruscem mumkun mu',
    'bir insanla konusmak istiyorum',
    'operator baglar misin',
    'personelle gorusmek istiyorum',
    'sekreter arayabilir mi',
    'beni klinikten arasinlar',
    'dr ile gorusmek istiyorum',
    'doktoruma mesaj iletir misiniz',
    'yetkili biri donsun',
    'resepsiyonla konusmam lazim',
    'ekibe yazabilir misiniz',
    'canli biri yardim etsin',
    'robot istemiyorum personel lazim',
    'benimle bir yetkili ilgilensin',
    'klinik beni arar mi',
    'temsilci baglayin',
    'yetkiliye aktarir misiniz',
    'gercek biriyle gorusebilir miyim',
    'doktor hanim beni arasin',
    'personelden biri donsun',
    'hasta kabul ile konusabilir miyim',
    'ekipten biri yazsin',
    'klinik ekibinizle gorusmek istiyorum',
    'canli destekle konusayim',
    'beni yetkiliye aktar',
    'konuyu personele ilet',
    'doktor beyle gorusmem gerekiyor',
    'sekreterle baglanti kurabilir miyim',
  ]),

  ...cases('symptom_or_complaint', 'symptom_or_complaint', 'start_general_assessment', [
    'dism cok agriyo',
    'dis etim kaniyor',
    'dolgu dustu ne yapayim',
    'yuzum sisti',
    'cok hassasiyet var',
    'cenem sanci yapiyor',
    'kaplama dustu',
    'apse gibi sislik var',
    'disim catladi',
    'agzim aciyor',
    'disim zonkluyor',
    'gece agri uyutmuyor',
    'dolgum dustu',
    'disimde delik var',
    'disimden parca koptu',
    'damagim sisti',
    'agzimda yara var',
    'sicak soguk hassasiyet yapiyor',
    'disim sallaniyor',
    'braketim cikti',
    'telim batti',
    'yirmilik disim agriyor',
    'disimde curuk var gibi',
    'agzim kokuyor',
    'kan geliyor dis etinden',
    'dis eti cekilmesi var',
    'implantim agriyor',
    'disimin kenari kirildi',
    'agri kesici almadan duramiyorum',
    'cenemde sislik olustu',
    'dis etim sisti',
    'disim acayip sizliyor',
    'damakta yara cikti',
    'kaplamam oynuyor',
    'disimde iltihap olabilir',
    'yanagim sisti',
    'disim kirildi randevu lazim',
    'sadece agri var hangi hizmet bilmiyorum',
    'tam bilmiyorum disim aciyor',
    'kanama var acil bakilmasi lazim',
    'disimde sanci var',
    'sag tarafta agri var',
    'sol alt disim sizliyor',
    'disim yemek yerken aciyor',
    'dolgumun oldugu yer agriyor',
  ]),

  ...cases('clinic_info', 'clinic_info', 'answer_clinic_info', [
    'klinikte kac hkm var',
    'kac doktor calisiyor',
    'adresiniz nerede',
    'konum atar misiniz',
    'telefon numaraniz nedir',
    'ogle arasi var mi',
    'bugun acik misiniz',
    'kacta kapaniyor',
    'kac hekim var',
    'doktor sayisi kac',
    'hekim sayisi nedir',
    'klinik nerede acaba',
    'nerdesiniz',
    'lokasyon bilgisi alabilir miyim',
    'harita linki var mi',
    'yol tarifi verir misiniz',
    'mail adresiniz nedir',
    'email alabilir miyim',
    'eposta var mi',
    'web siteniz var mi',
    'hafta sonu acik misiniz',
    'cumartesi calisiyor musunuz',
    'pazar acik mi',
    'yarin acik misiniz',
    'hangi gunler aciksiniz',
    'mesai saatleriniz nedir',
    'calisma saatleri ne',
    'kacta aciliyorsunuz',
    'oglen calisiyor musunuz',
    'ogle molasi saat kacta',
    'doktorlar kimler',
    'hekimler kim',
    'klinik telefonu nedir',
    'whatsapp numaraniz bu mu',
    'bayramda acik mi',
  ]),

  ...cases('appointment_query', 'appointment_query', 'appointment_lookup', [
    'randevm varmi',
    'randevuma bakar misiniz',
    'randevu durumumu goster',
    'randvum ne zaman',
    'rndvum var mi',
    'randevum saat kacta',
    'bugun randevum var mi',
    'yarin randevum var mi',
    'randevumu hatirlatir misiniz',
    'randevu bilgilerim nedir',
    'benim randevu kaydim var mi',
    'adima randevu gorunuyor mu',
    'randevumu ogrenmek istiyorum',
    'randevuma bakabilir misiniz',
    'randevumun saatini unuttum',
    'randevu saatimi soyler misin',
    'mevcut randevumu goster',
    'randevumun durumu nedir',
    'kayitli randevum var mi',
    'randvum saat kactaydi',
    'rndvum ne zamandi',
    'randevumu kontrol eder misiniz',
    'benim randv hangi gundu',
    'randevu listemi goster',
    'randevu kaydim cikiyor mu',
  ]),

  ...cases('cancel_appointment', 'cancel_appointment', 'cancel_appointment', [
    'randevumu iptal et',
    'randv iptal',
    'rndv sil',
    'yarinkini iptal et',
    'bugunkunu siler misiniz',
    'randevuyu iptal etmek istiyorum',
    'yarinki randevu iptal olsun',
    'bugunku randevuyu silelim',
    'randevuma gelemeyecegim iptal',
    'randvumu siler misiniz',
    'randevudan vazgectim',
    'iptal edebilir misiniz randevumu',
    'randevumu kaldirin',
    'yarin olan randevuyu iptal edelim',
    'randevuya gelemem iptal edin',
    'mevcut randevumu sil',
    'o randevu iptal olsun',
    'gelmeyecegim randevuyu iptal edin',
    'randevumu bozmak istiyorum',
    'randevu iptali yapmak istiyorum',
  ]),

  ...cases('service_info', 'service_info', 'answer_service_info', [
    'hangi hizmetler var',
    'tedaviler neler',
    'fiyat bilgisi alabilir miyim',
    'ucretler nasil',
    'implant var mi',
    'kanal tedavisi yapiyor musunuz',
    'dis beyazlatma var mi',
    'ortodonti hizmetiniz var mi',
    'tel takiyor musunuz',
    'zirkonyum kaplama yapiyor musunuz',
    'lamina var mi',
    'dis cekimi hizmeti var mi',
    'muayene ucreti ne kadar',
    'fiyat listesi alabilir miyim',
    'dolgu yapiyor musunuz',
    'kaplama yapiyor musunuz',
    'dis tasi temizligi var mi',
    'temizlik hizmeti var mi',
    'cerrahi islemler var mi',
    'neler yapiyorsunuz klinikte',
  ]),

  ...cases('off_topic_or_smalltalk', 'off_topic_or_smalltalk', 'reply_only', [
    'saat kac oldu',
    'nasilsin',
    'naber',
    'su an saat kac',
    'saat kactir',
    'hava nasil',
    'iyi misin',
    'bugun gunlerden ne',
    'sen kimsin',
    'bot musun',
  ]),

  ...cases('book_appointment', 'book_appointment', 'start_booking', [
    'randevu almak istiyorum',
    'randv alcam',
    'muayene olmak istiyorum',
    'yarin gelebilirim',
    '12 14 arasi musaitim',
    'kontrol ettirmek istiyorum',
    'randevu yazabilir misiniz',
    'randevu olusturmak istiyorum',
    'bu hafta randevu var mi',
    'musait randevu var mi',
    'uygun saat var mi',
    'sali icin yer var mi',
    'yarin 12de gelebilir miyim',
    'ogle arasi gelebilirim',
    'genel muayene istiyorum',
    'kontrole gelmek istiyorum',
    'bakabilir misiniz',
    'disime baktirmak istiyorum',
    'muayene icin saat bakar misiniz',
    'randevu ayarlayabilir miyiz',
    'bugun uygun musunuz',
    'yarin uygun musunuz',
    'haftaya gelmek istiyorum',
    'cuma musait randevu var mi',
    'randvu almak istiyom',
    'rndv alabilir miyim',
    'dis kontrolu icin randevu',
    'ogleden sonra musaitim',
    'sabah erken gelebilirim',
    '15 ten sonra uygunum',
    '12 ile 14 arasi uygunum',
    'bugun muayene var mi',
    'yarin muayene olmak istiyorum',
    'randevu icin yaziyorum',
    'klinikte yer var mi yarin',
  ]),

  ...cases('book_appointment_continue', 'book_appointment', 'continue_booking', [
    'yarin gelebilirim',
    'sali olsun',
    '12 14 arasi musaitim',
    'ogleden sonra olur',
    '15 ten sonra bakabilir misiniz',
    'cuma gunu istiyorum',
    'sabah erken uygunum',
    'bu hafta icinde olur',
    '18 mayis olabilir',
    '14:30 iyi',
  ], 'awaiting_date'),
];

const unknownCases: UnknownCase[] = [
  { category: 'unknown', message: 'arac plakam kayitli mi' },
  { category: 'unknown', message: 'sigorta poliçemi yükleyebilir miyim' },
  { category: 'unknown', message: 'faturami muhasebeye yollar misiniz' },
  { category: 'unknown', message: 'hangi renk secmeliyim' },
  { category: 'unknown', message: 'cocuklar icin oyun alani var mi' },
  { category: 'unknown', message: 'kahve ikram ediyor musunuz' },
  { category: 'unknown', message: 'eczane onerir misiniz' },
  { category: 'unknown', message: 'bana kampanya kodu gonder' },
  { category: 'unknown', message: 'instagram hesabiniz neden kapali' },
  { category: 'unknown', message: 'klima calisiyor mu' },
];

const metrics = new Map<string, { total: number; passed: number }>();
let passed = 0;

const recordMetric = (category: string, didPass: boolean) => {
  const current = metrics.get(category) ?? { total: 0, passed: 0 };
  current.total += 1;
  if (didPass) current.passed += 1;
  metrics.set(category, current);
};

for (const item of evaluationCases) {
  const decision = buildFallbackWhatsAppAgentDecision(makeAgentArgs(item.message, item.currentStep));
  const didPass = Boolean(decision && decision.intent === item.intent && decision.action === item.action);
  recordMetric(item.category, didPass);

  assert.ok(decision, `Expected a decision for: ${item.message}`);
  assert.equal(decision.intent, item.intent, `intent mismatch for: ${item.message}`);
  assert.equal(decision.action, item.action, `action mismatch for: ${item.message}`);
  if (item.intent === 'symptom_or_complaint') {
    assert.ok(decision.safetyFlags.includes('no_diagnosis'), `missing no_diagnosis flag for: ${item.message}`);
    assert.ok(decision.safetyFlags.includes('no_treatment_advice'), `missing no_treatment_advice flag for: ${item.message}`);
    assert.doesNotMatch(decision.reply ?? '', /ilaç|ilac|tedavi|teşhis|teshis|tanı|tani/i);
  }
  passed += 1;
}

for (const item of unknownCases) {
  const decision = buildFallbackWhatsAppAgentDecision(makeAgentArgs(item.message));
  const didPass = decision === null;
  recordMetric(item.category, didPass);
  assert.equal(decision, null, `Expected no fallback decision for unsupported message: ${item.message}`);
  passed += 1;
}

const metricSummary = [...metrics.entries()]
  .map(([category, metric]) => `${category}:${metric.passed}/${metric.total}`)
  .join(', ');

console.log(`WhatsApp agent fallback evaluation passed: ${passed}/${evaluationCases.length + unknownCases.length}`);
console.log(`WhatsApp agent fallback metrics: ${metricSummary}`);
