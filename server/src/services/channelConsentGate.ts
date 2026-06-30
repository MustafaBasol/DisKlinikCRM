/**
 * channelConsentGate.ts
 *
 * Consent gate for WhatsApp and Instagram channels.
 *
 * Before creating any patient, appointment request, or contact request from a
 * channel message, callers must:
 *   1. Call checkChannelConsent() to determine if explicit consent is on file.
 *   2. If status === 'needs_consent', send promptText to the user and store
 *      conversation step 'awaiting_channel_consent'.
 *   3. When the user replies, call parseConsentReply() and then logChannelConsent().
 *
 * No secrets, tokens, or full message content are stored in consent logs.
 */

import prisma from '../db.js';

export type ConsentChannel = 'whatsapp' | 'instagram';

export type ConsentGateResult =
  | { status: 'accepted' }
  | {
      status: 'needs_consent' | 'declined';
      promptText: string;
      consentTextVersion: string;
      consentTextSnapshot: string;
      privacyUrl: string;
    }
  | { status: 'blocked_missing_legal_profile' };

const BASE_URL = process.env.APP_BASE_URL?.replace(/\/$/, '') ?? 'https://app.noramedi.com';

const MISSING_PROFILE_BLOCK_TR =
  'Bu klinik için KVKK aydınlatma metni henüz yayınlanmadığı için otomatik randevu akışını başlatamıyorum. Lütfen klinik ile doğrudan iletişime geçin veya daha sonra tekrar deneyin.';

const buildConsentPromptText = (privacyUrl: string, consentText: string | null | undefined): string => {
  if (consentText?.trim()) {
    return consentText.trim().replace('{privacyUrl}', privacyUrl);
  }
  return (
    'Merhaba. Randevu talebinizi alabilmemiz ve size dönüş yapabilmemiz için ad, soyad, ' +
    'iletişim bilgileriniz, randevu tercihiniz ve mesaj içeriğiniz işlenebilir.\n\n' +
    `Aydınlatma metni:\n${privacyUrl}\n\n` +
    'Randevu talebimin alınması ve tarafıma dönüş yapılması amacıyla kişisel verilerimin ' +
    'işlenmesini kabul ediyor musunuz?\n\n' +
    '1. Evet, onaylıyorum\n' +
    '2. Hayır, onaylamıyorum'
  );
};

/**
 * Check whether the contact has valid consent for the given clinic/channel/version.
 *
 * Returns:
 *   'accepted'                  — valid accepted consent on file; caller may proceed
 *   'needs_consent'             — no valid consent; caller must send promptText
 *   'declined'                  — last consent was declined; caller must send promptText
 *   'blocked_missing_legal_profile' — clinic has no published legal profile
 */
export async function checkChannelConsent(args: {
  organizationId: string;
  clinicId: string;
  channel: ConsentChannel;
  contactIdentifier: string;
}): Promise<ConsentGateResult> {
  const legalProfile = await prisma.clinicLegalProfile.findUnique({
    where: { clinicId: args.clinicId },
    select: {
      isPublished: true,
      privacyNoticeVersion: true,
      channelConsentText: true,
      clinic: { select: { slug: true } },
    },
  });

  if (!legalProfile?.isPublished) {
    return { status: 'blocked_missing_legal_profile' };
  }

  const version = legalProfile.privacyNoticeVersion ?? '1.0';
  const privacyUrl = `${BASE_URL}/c/${legalProfile.clinic.slug}/kvkk`;
  const consentSnapshot = buildConsentPromptText(privacyUrl, legalProfile.channelConsentText);

  const latestLog = await prisma.channelConsentLog.findFirst({
    where: {
      clinicId: args.clinicId,
      channel: args.channel,
      contactIdentifier: args.contactIdentifier,
    },
    orderBy: { createdAt: 'desc' },
    select: { consentStatus: true, consentTextVersion: true },
  });

  if (latestLog?.consentStatus === 'accepted' && latestLog.consentTextVersion === version) {
    return { status: 'accepted' };
  }

  if (latestLog?.consentStatus === 'declined') {
    return {
      status: 'declined',
      promptText: consentSnapshot,
      consentTextVersion: version,
      consentTextSnapshot: consentSnapshot,
      privacyUrl,
    } as ConsentGateResult;
  }

  return {
    status: 'needs_consent',
    promptText: consentSnapshot,
    consentTextVersion: version,
    consentTextSnapshot: consentSnapshot,
    privacyUrl,
  };
}

/**
 * Parse a user's reply to a consent prompt.
 * Returns 'accepted', 'declined', or null (ambiguous — re-show prompt).
 */
export function parseConsentReply(text: string): 'accepted' | 'declined' | null {
  const normalized = text
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-zA-ZğüşıöçĞÜŞİÖÇ0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const acceptPatterns = [
    /^1$/,
    /^evet$/,
    /^evet\s+onayl[ıi]yorum$/,
    /^onayl[ıi]yorum$/,
    /^kabul\s+ediyorum$/,
    /^tamam$/,
    /^ok$/,
    /^yes$/,
    /^oui$/,
    /^ja$/,
  ];
  if (acceptPatterns.some(p => p.test(normalized))) return 'accepted';

  const declinePatterns = [
    /^2$/,
    /^hay[ıi]r$/,
    /^onaylam[ıi]yorum$/,
    /^kabul\s+etmiyorum$/,
    /^istemiyorum$/,
    /^no$/,
    /^non$/,
    /^nein$/,
  ];
  if (declinePatterns.some(p => p.test(normalized))) return 'declined';

  return null;
}

/**
 * Log a consent decision. Skips creating a new accepted log when an identical
 * accepted record already exists (deduplication).
 */
export async function logChannelConsent(args: {
  organizationId: string;
  clinicId: string;
  channel: ConsentChannel;
  contactIdentifier: string;
  status: 'accepted' | 'declined';
  consentTextVersion: string;
  consentTextSnapshot: string;
  privacyUrl: string;
  locale?: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
}): Promise<void> {
  if (args.status === 'accepted') {
    const existing = await prisma.channelConsentLog.findFirst({
      where: {
        clinicId: args.clinicId,
        channel: args.channel,
        contactIdentifier: args.contactIdentifier,
        consentStatus: 'accepted',
        consentTextVersion: args.consentTextVersion,
      },
      select: { id: true },
    });
    if (existing) return;
  }

  const now = new Date();
  await prisma.channelConsentLog.create({
    data: {
      organizationId: args.organizationId,
      clinicId: args.clinicId,
      channel: args.channel,
      contactIdentifier: args.contactIdentifier,
      conversationId: args.conversationId ?? null,
      sourceMessageId: args.sourceMessageId ?? null,
      consentStatus: args.status,
      consentTextVersion: args.consentTextVersion,
      consentTextSnapshot: args.consentTextSnapshot,
      privacyUrl: args.privacyUrl,
      locale: args.locale ?? 'tr',
      acceptedAt: args.status === 'accepted' ? now : null,
      declinedAt: args.status === 'declined' ? now : null,
    },
  });
}

/**
 * Load consent info needed to log a consent decision without repeating the
 * legal-profile lookup. Returns null when clinic has no published profile.
 */
export async function loadConsentMetadata(clinicId: string): Promise<{
  version: string;
  privacyUrl: string;
  consentSnapshot: string;
} | null> {
  const legalProfile = await prisma.clinicLegalProfile.findUnique({
    where: { clinicId },
    select: {
      isPublished: true,
      privacyNoticeVersion: true,
      channelConsentText: true,
      clinic: { select: { slug: true } },
    },
  });

  if (!legalProfile?.isPublished) return null;

  const version = legalProfile.privacyNoticeVersion ?? '1.0';
  const privacyUrl = `${BASE_URL}/c/${legalProfile.clinic.slug}/kvkk`;
  const consentSnapshot = buildConsentPromptText(privacyUrl, legalProfile.channelConsentText);
  return { version, privacyUrl, consentSnapshot };
}

export const MISSING_LEGAL_PROFILE_BLOCK_TEXT = MISSING_PROFILE_BLOCK_TR;
export const CONSENT_DECLINED_TEXT =
  'Anlıyorum. Kişisel verilerinizin işlenmesini onaylamadığınız için talebinizi otomatik olarak işleyemiyorum. Klinik ile doğrudan iletişime geçebilirsiniz.';
export const CONSENT_ACCEPTED_TEXT =
  'Teşekkürler, onayınızı aldık. Randevu almak veya bilgi sormak için talebinizi yazabilirsiniz.';
export const CONSENT_REPROMPT_TEXT =
  'Lütfen 1 (Evet, onaylıyorum) veya 2 (Hayır, onaylamıyorum) seçeneğini girin.';
