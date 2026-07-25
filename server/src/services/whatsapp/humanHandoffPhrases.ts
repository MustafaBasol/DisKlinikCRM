/**
 * humanHandoffPhrases.ts — single source of truth for "the user wants a human"
 * phrase detection.
 *
 * Previously duplicated as two independently-maintained keyword lists
 * (metaWhatsAppAiProcessor.ts's isHumanHandoffRequest and
 * whatsappStepAwareNlu.ts's POST_BOOKING_HANDOFF_PHRASES) that had drifted:
 * the post_booking list recognized "danışmanla görüş"/"biriyle görüşmek
 * istiyorum" but the earlier step-escape gate did not, so those phrases
 * reached the post_booking classifier correctly as human_handoff while the
 * consumer had nothing wired to act on it. Both call sites now import this
 * single pure predicate instead.
 */

const normalizeForHandoffMatch = (value: string) => value
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i')
  .replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const HUMAN_HANDOFF_PHRASES = [
  'yetkili', 'temsilci', 'operator', 'canli destek',
  'insanla gorus', 'personelle gorus', 'danismanla gorus',
  'resepsiyonla gorus', 'biriyle gorusmek istiyorum', 'beni arasin',
];

export const isHumanHandoffPhrase = (rawText: string): boolean => {
  const text = normalizeForHandoffMatch(rawText);
  return HUMAN_HANDOFF_PHRASES.some(p => text.includes(p));
};
