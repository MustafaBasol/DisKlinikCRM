/**
 * webhookAckGate.ts — F5-3 one, and only one, response per webhook request.
 *
 * The Meta WhatsApp and Instagram webhook handlers answer the provider at the
 * TOP of the function and then run every early-return branch (malformed
 * payload, unresolvable connection, bad signature, nothing to do) relying on
 * "we already sent 200". That is why the durable write ended up AFTER the ACK:
 * once the response is out, ordering the rest is invisible.
 *
 * Moving the ACK later means those branches must each still answer, and must
 * answer exactly once — `res.status(200)` twice is an
 * `ERR_HTTP_HEADERS_SENT` crash in a public route. This gate makes "answer
 * once, whenever we get there" a property of an object rather than something
 * every branch has to remember.
 *
 * The `fail()` path is the actual point of the exercise. When durable
 * acceptance is enabled and the acceptance itself fails, answering 200 would
 * tell the provider "received" about a message that reached nothing — and Meta
 * never redelivers a 200. A 503 instead makes the provider's own retry the
 * backstop, which is the correct behaviour and is only available while the
 * response has not gone out yet.
 */

import type { Response } from 'express';

export interface WebhookAckGate {
  /** Answer 200. No-op if anything has already been sent. */
  ack(): void;
  /**
   * Answer 503 so the provider retries. No-op if anything has already been
   * sent — in particular, in legacy (flag-off) mode the 200 is already gone and
   * this correctly does nothing, preserving today's behaviour exactly.
   */
  fail(reason: string): void;
  readonly sent: boolean;
}

/**
 * `okStyle` preserves each route's EXISTING success response byte for byte.
 * The Meta routes answer `200 {"status":"ok"}`; the Instagram routes answer a
 * bare `res.sendStatus(200)`. Introducing a gate must not quietly change either
 * — a provider or a contract test that asserts on the body would break for a
 * reason entirely unrelated to reliability.
 */
export function createWebhookAckGate(
  res: Response,
  okStyle: 'json' | 'status' = 'json',
): WebhookAckGate {
  let sent = false;
  return {
    ack() {
      if (sent) return;
      sent = true;
      if (okStyle === 'status') res.sendStatus(200);
      else res.status(200).json({ status: 'ok' });
    },
    fail(reason: string) {
      if (sent) return;
      sent = true;
      // The reason is a stable code chosen by us, never provider text.
      res.status(503).json({ error: 'WEBHOOK_ACCEPTANCE_FAILED', reason });
    },
    get sent() {
      return sent;
    },
  };
}
