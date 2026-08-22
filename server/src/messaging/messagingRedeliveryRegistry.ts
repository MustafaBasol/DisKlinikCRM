/**
 * messagingRedeliveryRegistry.ts — F5-3 which channels can actually be re-driven.
 *
 * THE MEASURED FACT
 * -----------------
 * `jobs/inboundEventRetryJob.ts` selects `channel: 'whatsapp', provider:
 * 'meta_cloud_api'` and nothing else. Its own header says so:
 *
 *   > Şimdilik yalnızca channel=whatsapp / provider=meta_cloud_api yeniden
 *   > işlenir ... Evolution ve Instagram event'leri failed olarak kalır;
 *   > handler eklendiğinde SUPPORTED_PROVIDERS'a eklenir.
 *
 * So a failed Evolution WhatsApp or Instagram inbound message sits `failed`
 * forever. Not retried, not terminal, not surfaced, not replayable — and
 * indistinguishable from a Meta event that is about to be retried in four
 * minutes.
 *
 * WHAT F5-3 CHANGES, AND WHAT IT DELIBERATELY DOES NOT
 * ----------------------------------------------------
 * It does **not** write re-delivery handlers for Evolution and Instagram. That
 * would mean re-driving a conversational AI turn hours after the patient sent
 * it — replying to a question they have moved on from, or re-entering a booking
 * flow whose slot is gone. The six-hour `RETRY_WINDOW_MS` in the existing job
 * exists precisely because the author already recognised that risk for Meta
 * ("bayat AI yanıtı göndermeyi önler"), and extending it blindly to two more
 * channels would be building the risky half of the feature.
 *
 * It **does** make the absence honest. A channel with no handler is registered
 * here as unsupported, its failures become terminal with the stable code
 * `NO_RETRY_HANDLER`, and they appear in the DLQ view where an operator can see
 * that a real message was received and never answered. That is a capability
 * that did not exist; a silent `failed` row was not one.
 *
 * Adding a handler later is a one-line change here plus the handler — and the
 * registry is what makes "which channels are covered" a reviewable fact rather
 * than a filter buried in a `findMany`.
 */

export interface MessagingRedeliveryTarget {
  readonly channel: string;
  readonly provider: string;
}

export interface MessagingRedeliverySupport {
  readonly channel: string;
  readonly provider: string;
  /** Whether an automatic/manual re-delivery handler exists for this channel. */
  readonly supported: boolean;
  /** Why. Required for both answers — an unsupported channel needs a reason too. */
  readonly rationale: string;
}

/**
 * Every channel/provider pair that writes to `MessagingInboundEvent`, with
 * whether it can be re-driven. Held to the real writers by
 * `tests/messagingReliability.test.ts`, so a fourth channel cannot be added
 * without someone answering this question.
 */
export const MESSAGING_REDELIVERY_SUPPORT: readonly MessagingRedeliverySupport[] = Object.freeze([
  {
    channel: 'whatsapp',
    provider: 'meta_cloud_api',
    supported: true,
    rationale:
      'services/whatsapp/metaInboundDelivery.deliverIncomingMetaMessage re-drives a stored envelope ' +
      'from rawPayload. This is the flow inboundEventRetryJob has always retried.',
  },
  {
    channel: 'whatsapp',
    provider: 'evolution',
    supported: false,
    rationale:
      'No re-delivery handler exists. Building one means re-running a conversational AI turn from a ' +
      'stored envelope, which risks answering a question the patient has moved on from or re-entering ' +
      'a booking flow whose slot is gone. F5-3 makes the failure terminal and visible instead of ' +
      'silently retryable-forever; the handler is a separate, deliberate task.',
  },
  {
    channel: 'instagram',
    provider: 'meta_graph',
    supported: false,
    rationale:
      'Same reasoning as Evolution WhatsApp: no handler exists, and re-driving a stale DM turn is a ' +
      'product decision, not a reliability one.',
  },
]);

const SUPPORT_BY_KEY: ReadonlyMap<string, MessagingRedeliverySupport> = new Map(
  MESSAGING_REDELIVERY_SUPPORT.map((s) => [`${s.channel}|${s.provider}`, s]),
);

export function getRedeliverySupport(
  target: MessagingRedeliveryTarget,
): MessagingRedeliverySupport | undefined {
  return SUPPORT_BY_KEY.get(`${target.channel}|${target.provider}`);
}

/**
 * Fail CLOSED: a channel nobody has classified is treated as unsupported, not
 * as supported-by-default. An unknown writer must not silently acquire the
 * ability to re-drive a patient conversation.
 */
export function isRedeliverySupported(target: MessagingRedeliveryTarget): boolean {
  return getRedeliverySupport(target)?.supported === true;
}

/** The pairs the retry job may select. Derived, never hand-maintained. */
export function getSupportedRedeliveryTargets(): readonly MessagingRedeliveryTarget[] {
  return Object.freeze(
    MESSAGING_REDELIVERY_SUPPORT.filter((s) => s.supported).map((s) => ({
      channel: s.channel,
      provider: s.provider,
    })),
  );
}
