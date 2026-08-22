/**
 * startOutbox.ts — F5-2 the single place consumers become reachable.
 *
 * Consumer registration is separated from the modules that define consumers so
 * that importing a consumer (for a type, in a test, or transitively) never
 * mutates global state. It also means "which consumers exist in production" is
 * one readable list rather than a property of the import graph.
 *
 * Called from `startBackgroundJobs()`. Registration is UNCONDITIONAL and
 * independent of `OUTBOX_DISPATCH_ENABLED`: registering a handler is inert —
 * it starts nothing, queries nothing, and schedules nothing — and having the
 * registry populated regardless means a dispatcher enabled at runtime never
 * finds itself with events it has no consumer for.
 */

import { registerAppointmentRequestConfirmationConsumer } from './consumers/appointmentRequestConfirmationConsumer.js';
import { getRegisteredConsumerKeys } from './outboxConsumerRegistry.js';

let registered = false;

export function registerOutboxConsumers(): readonly string[] {
  if (!registered) {
    registerAppointmentRequestConfirmationConsumer();
    registered = true;
  }
  return getRegisteredConsumerKeys();
}
