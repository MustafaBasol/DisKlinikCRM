/**
 * messagingReliabilityConfig.ts — F5-3 rollout controls.
 *
 * Only ONE behaviour in F5-3 changes what a production webhook does from the
 * outside, and it is the one that needs a switch: the order of the durable
 * write and the 200 ACK.
 *
 * Everything else — terminal states, backoff, stable error codes, timeouts,
 * DLQ inspection, replay — either makes an existing failure visible or bounds
 * an existing call. None of that alters a provider-facing contract, so none of
 * it is gated: gating a strict improvement behind a flag nobody remembers to
 * turn on is how a fix ships and never takes effect.
 *
 * FLAG SEMANTICS follow the repository convention (`CLINIC_BULK_EXPORT_ENABLED`,
 * and F5-2's outbox flags): the value must be exactly `'true'`. Anything else —
 * unset, empty, `'1'`, `'yes'`, a typo — is OFF.
 */

function isEnabled(raw: string | undefined): boolean {
  return raw === 'true';
}

/**
 * Whether the Meta WhatsApp and Instagram webhooks must durably accept an event
 * BEFORE sending the 200.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * At the F5-3 baseline both routes answer the provider first:
 *
 *     router.post('/whatsapp/meta/webhook', async (req, res) => {
 *       res.status(200).json({ status: 'ok' });   // <- ACK
 *       ...
 *       await createInboundEventOrDetectDuplicate(...)   // <- durable write
 *
 * Between those two lines the message exists only in memory. A process exit, a
 * database blip, or a connection-pool exhaustion in that window loses it
 * **permanently** — and because the provider already has its 200, Meta will
 * never redeliver it. The inbound retry job cannot help either: it retries rows
 * in the ledger, and this message never reached the ledger.
 *
 * Evolution WhatsApp already gets this right (it writes the ledger row before
 * every one of its 200 responses) — at the cost of the opposite problem, since
 * it answers only after full AI processing.
 *
 * ── WHY IT IS FLAG-GATED ANYWAY ──────────────────────────────────────────────
 * Reordering makes the ACK wait on a JSON parse, a connection lookup, a
 * signature check and one INSERT — a few milliseconds, comfortably inside any
 * provider timeout. It is still a change to the response timing of a live
 * webhook that a real provider is calling, and this program does not ship those
 * silently. OFF by default means deploying this branch is behaviourally
 * identical to today; the runbook documents turning it on as its own step with
 * its own verification.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * It does NOT move processing before the ACK. The shape stays
 * `validate -> durably accept/dedupe -> ACK -> process asynchronously`, which is
 * the fast-ack architecture; the only thing that moves is the durable write,
 * from after the ACK to before it. There is no in-memory queue and no
 * Redis-only path anywhere in F5-3: `MessagingInboundEvent` remains the single
 * inbound durability ledger.
 */
export function isDurableAckBeforeResponseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnabled(env.MESSAGING_DURABLE_ACK_ENABLED);
}
