# WhatsApp Conversation Management Improvement

Date: 2026-06-03

## Goal

WhatsApp assistant behavior was changed from a menu-first bot to a clinic consultation assistant. The assistant should understand natural language first, use conversation state only as context, and avoid repeatedly sending the same main menu.

## Plan

1. Inspect the current WhatsApp webhook, AI extraction, intent router, and booking state handlers.
2. Expand intent detection to cover:
   - GREETING
   - BOOK_APPOINTMENT
   - APPOINTMENT_QUERY
   - CANCEL_APPOINTMENT
   - HUMAN_HANDOFF
   - CLINIC_INFO
   - SERVICE_INFO
   - SYMPTOM_OR_COMPLAINT
   - OFF_TOPIC_OR_SMALLTALK
   - UNKNOWN
3. Run intent detection before state-specific handlers so the assistant does not get stuck in `awaiting_service`, `awaiting_date`, or similar states.
4. Add priority routing for human handoff, clinic information, symptoms/complaints, off-topic small talk, appointment lookup, and cancellation.
5. Keep menus only for initial greeting, explicit menu requests, and simple deterministic numeric choices.
6. Add a general assessment path for users who do not know the service name or report a symptom, without diagnosis or treatment advice.
7. Update tests and verify type/build health.

## What Changed

### AI extraction

`server/src/services/googleAiStudio.ts` now supports the expanded intent list. The prompt explicitly tells the AI extractor to:

- classify human representative requests as `human_handoff`;
- classify clinic facts such as doctor count and working hours as `clinic_info`;
- classify pain, swelling, broken tooth, bleeding, and similar messages as `symptom_or_complaint`;
- avoid treating clinic-hours questions as appointment lookup;
- avoid treating symptoms as service-number selection failures.

The rule-based fallback was also expanded so critical intents still work if the AI key is missing or the AI request fails.

### State handling

`server/src/routes/whatsapp.ts` now performs preflight intent detection before the state handlers. State still helps continue a booking flow, but it no longer blocks unrelated user messages.

Examples of priority behavior:

- `Yetkili ile görüşmek istiyorum` creates a staff-visible `AppointmentRequest` with `requestType: info`, switches to `awaiting_handoff_note`, and asks for an optional note.
- `Dişim ağrıyor` is handled as symptom/complaint and routes to general muayene / acil değerlendirme wording.
- `Klinikte kaç doktor çalışıyor` answers from active doctor records when available.
- Unknown clinic info is not invented; the assistant says it cannot see the information clearly and offers to route it to staff.
- `Saat kaç` is answered with the clinic timezone time and then the assistant can continue the existing booking flow.

### General assessment flow

New lightweight states were added:

- `awaiting_general_date`
- `awaiting_general_time`
- `awaiting_handoff_note`

The general assessment flow captures date and time preferences without forcing a service number. When enough information is available, it creates a pending WhatsApp appointment request with no diagnosis or treatment recommendation.

### Menu behavior

The resolved intent router no longer falls back to the main menu for unknown high-confidence messages. It asks for a short clarification instead.

Repeated greetings while already in `main_menu` now get a short conversational response instead of the full numbered menu. Invalid numeric input in the main menu no longer reprints the whole menu.

## Safety Rules Preserved

- No diagnosis is generated.
- No treatment advice is generated.
- Sensitive complaint text is not echoed into reminder-style outbound messages.
- Unknown clinic facts are not fabricated.
- Staff handoff and general assessment requests are recorded as operational requests for clinic follow-up.

## Files Changed

- `server/src/routes/whatsapp.ts`
- `server/src/services/googleAiStudio.ts`
- `server/src/services/whatsappClarification.ts`
- `server/src/services/whatsappResolvedIntentRouter.ts`
- `server/src/tests/whatsappConversationFixtures.ts`
- `docs/41-whatsapp-conversation-management.md`

## Verification

Completed successfully:

- `npm.cmd run typecheck` in `server`
- `npm.cmd run test:fixtures` in `server`
- `npm.cmd run build` at project root
