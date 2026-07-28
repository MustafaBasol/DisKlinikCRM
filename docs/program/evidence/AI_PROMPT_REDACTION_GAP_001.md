# AI-PROMPT-REDACTION-GAP-001 — AI Prompt Privacy Boundary

**Status:** `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`

**Branch:** `fix/ai-prompt-redaction-gap-001`
**Worktree:** `E:/Ek Gelir/Siteler/DisKlinikCRM-worktrees/ai-prompt-redaction-gap-001` (fresh worktree; primary working tree untouched)

---

## 1. Baseline

Task brief specified baseline `26c6c339a7cd8db06b1707c059f7f27857f45e61`. At session start,
`origin/main` had advanced to:

```
94cc4ac58f0487dd186886878c5628627f0b1ce3
```

Drift review (`git log 26c6c33..94cc4ac`): 3 commits, all docs-only (F1-001 impact-based
test-selection architecture design/reconciliation). No AI/Gemini module was touched by the
drift. The branch was cut from `94cc4ac` (actual current `origin/main`) with no further
review needed.

**Tooling note:** the task brief specified using "CodeGraph" scoped to `server/src`. No such
tool was available in this environment (`ToolSearch` returned no match). Investigation was
performed instead with targeted `Grep`/`Read` over `server/src`, cross-referencing every call
site of `getGoogleAiStudioConfig`/`generativelanguage.googleapis.com` to build the same call-path
map CodeGraph queries would have produced.

---

## 2. Confirmed pre-fix exposure

This gap was originally found and recorded in
`docs/program/evidence/KVKK_FINAL_RECONCILIATION_20260726.md` (§13, gap #2 of the gap table):
*"Gemini/Google AI calls send the raw, unredacted **latest** user message and **full** customer
name — contradicting the codebase's own documented invariant... which is enforced only on
prior-history messages, not the current one."*

Investigation confirmed and extended that finding. Three distinct prompt-construction sites call
the Google Generative Language API (`generativelanguage.googleapis.com`), all gated behind
`getGoogleAiStudioConfig()` (reads `GOOGLE_AI_STUDIO_API_KEY` / `GEMINI_API_KEY`):

| # | Module | Function | Reached from |
|---|---|---|---|
| 1 | `server/src/services/googleAiStudio.ts` | `extractAssistantInputWithGoogleAi`, `normalizeDateWithGoogleAi` | `routes/whatsapp.ts` (Evolution/native WhatsApp) |
| 2 | `server/src/services/whatsappAgentPrompt.ts` (built by `whatsappConversationAgent.ts`'s `resolveWhatsAppConversationAgentDecision`) | `buildWhatsAppAgentPrompt` | `routes/whatsapp.ts` (native WhatsApp), `services/whatsapp/metaWhatsAppAiProcessor.ts` (Meta WhatsApp), `services/instagram/instagramAiConversationProcessor.ts` (Instagram) |
| 3 | `server/src/services/whatsappStepAwareNlu.ts` | `buildStepAwarePrompt` (internal to `runGoogleStepAwareNlu`, reached via exported `resolveStepAwareWhatsAppIntent`) | `services/whatsapp/metaWhatsAppAiProcessor.ts` (Meta WhatsApp), `services/instagram/instagramAiConversationProcessor.ts` (Instagram) |

Path 2 (`buildWhatsAppAgentPrompt`) is the single shared boundary for all three channels
(native WhatsApp, Meta WhatsApp, Instagram) — Meta and Instagram are *not* distinct
implementations of this path, they call the identical exported function with per-channel data.
Path 3 was not named in the original reconciliation gap but exhibited the identical defect
pattern and is reachable from the same two channel processors that share Path 2, so it is
closed by this fix as well.

**Confirmed exposure, per path, before this fix:**

1. **`googleAiStudio.ts`** — `extractAssistantInputWithGoogleAi`: `args.text` (the current/latest
   customer message) was interpolated into the prompt via `JSON.stringify(args.text)` with **no**
   sanitization — only `sanitizeInboundMessageText` (trim + 2000-char cap) had run on it upstream,
   which does not touch PII. `args.customerName` (the **full** patient/customer name, e.g. `"Ahmet
   Yılmaz"`) was sent verbatim as `Known customer name: ${args.customerName}`. `normalizeDateWithGoogleAi`
   had the same unsanitized-`text` defect.
2. **`whatsappAgentPrompt.ts`** (`buildWhatsAppAgentPrompt`) — `args.latestMessage` was
   interpolated raw into `<customer_message>${args.latestMessage}</customer_message>`. Historical
   `args.recentMessages` were sanitized by the caller via `sanitizeAiMessageHistory` (phone/email
   only) in some call sites (native WhatsApp, Meta WhatsApp) but **not** in the Instagram call site
   (`recentMessages: []` is always passed there, so this specific gap didn't apply, but there was
   no defense-in-depth if that ever changed). The current/latest message was unsanitized in **all
   three** channels. `customerName` was already first-name-only at this site (pre-existing
   mitigation), but not run through any redaction, so a name field that happened to contain a
   phone/email/token would have leaked it unredacted.
3. **`whatsappStepAwareNlu.ts`** (`buildStepAwarePrompt`) — `args.userText` was interpolated raw
   into `<message>${args.userText}</message>`. This is the most severe instance in practice: when
   `currentStep` is `awaiting_phone`, `userText` **is** the phone number the customer is actively
   providing; when `currentStep` is `awaiting_name`, `userText` **is** the name text the customer
   just typed. Both were sent to Gemini completely unredacted.

**Verified NOT exposed (checked, no change needed):**

- **Logging.** No call site logs the constructed prompt string. `whatsapp.ts`'s
  `summarizeTextForLog` only ever logs `{ length }`, never raw text; `redactPhone` is used for
  every logged phone; `console.error('[whatsapp-assistant] ai-extraction-error', error)` and the
  equivalent in `whatsappConversationAgent.ts`/`whatsappStepAwareNlu.ts` log the `Error` object,
  whose message is built only from HTTP status + the provider's own error response body — never
  from the constructed prompt.
- **Internal IDs.** Appointment/service catalog IDs (`services: [{id, name}]`) are sent to the AI
  so it can return a matching `appointmentTypeId`/`extractedServiceId` — these are clinic-owned
  catalog identifiers, not patient/customer identifiers, and this is required for the feature to
  function (the AI has to reference something to say "the customer picked service X"). No
  patient/session/database-row IDs are sent anywhere in these prompts.

---

## 3. Redaction invariant (the shared boundary)

`server/src/services/privacy/redaction.ts` is the single AI prompt privacy boundary. It already
contained `redactSensitiveText` (phone/email only, historical messages only) and
`sanitizeAiMessageHistory`. This fix extends `redactSensitiveText` in place — not a parallel
implementation — and adds `getAiSafeFirstName`.

`redactSensitiveText(value: string): string` now redacts, in order:

1. JWT-shaped tokens (`ey....\....\....`) → `[TOKEN]`
2. `Bearer <token>` → `[TOKEN]`
3. `key: value` / `key=value` pairs where the key names a credential (`api_key`, `secret`, `token`,
   `password`, `pwd`, `cookie`, `bearer`, ...) → `key: [TOKEN]` (key name kept, value redacted)
4. Email addresses → `[EMAIL]`
5. UUIDs (v1–v5 shape) → `[ID]`
6. Phone-number candidates, **gated by digit count (9–15 digits)** → `[PHONE]`. The digit-count
   gate is what keeps an 8-digit Turkish date (`27.07.2026`) or a bare `HH:MM` time from being
   misread as a phone number — both are below the 9-digit floor, so booking date/time phrases
   survive redaction intact.
7. A catch-all for identifier/token-shaped strings the specific patterns above miss (malformed
   UUIDs, cuid/ObjectId-style database ids, etc.) — any 20+ character run of `[A-Za-z0-9_-]` that
   contains at least one digit → `[ID]`. The digit requirement is what keeps a long run of
   ordinary repeated/compound text from being misredacted (this was caught by the pre-existing
   `sanitizeAiMessageHistory` truncation test during implementation — see §6).

`getAiSafeFirstName(fullName)` returns only the first whitespace-delimited token of a name,
itself passed through `redactSensitiveText` as defense-in-depth (a name field that accidentally
contains a phone/email/token cannot leak it either). This is now the **only** form in which a
patient/customer name may reach any of the three prompt builders — never the full name.

**Fail-safe behavior:** `redactSensitiveText` wraps its entire body in try/catch. On any
unexpected failure it returns a fixed placeholder (`[REDACTED]`) — it never falls back to
returning the original, unredacted text.

**No dual logging:** nothing in this change logs a raw value alongside its redacted form; the
existing logging discipline (masked phone/email only, `{length}` for message text) is unchanged
and was verified, not just assumed (§2).

All three prompt-construction sites now route customer-controlled text through this one function
before it reaches the provider:

- `googleAiStudio.ts`: `args.text` → `redactSensitiveText(args.text)`; `normalizeDateWithGoogleAi`'s
  `text` → `redactSensitiveText(text)`; `args.customerName` → `getAiSafeFirstName(args.customerName)`.
- `whatsappAgentPrompt.ts`: `args.latestMessage` → `redactSensitiveText(args.latestMessage)`;
  every `args.recentMessages[i].text` is **re-sanitized inside the builder itself**
  (`redactSensitiveText`), regardless of whether the caller already sanitized it — this makes the
  boundary hold even if a future caller forgets, rather than depending on caller discipline;
  `args.customerName` → `getAiSafeFirstName(args.customerName)` (replacing the inline
  `split(/\s+/)[0]` that had no PII defense-in-depth).
- `whatsappStepAwareNlu.ts`: `args.userText` → `redactSensitiveText(args.userText)` inside
  `buildStepAwarePrompt`. Only the *prompt string* is sanitized — the raw `args.userText` is left
  untouched everywhere else in the module (deterministic local parsing: `interpretTimeRequest`,
  keyword matching in `ruleBasedStepAwareFallback`), so no booking-flow behavior changes.

---

## 4. Changed files

| File | Change |
|---|---|
| `server/src/services/privacy/redaction.ts` | Extended `redactSensitiveText` (JWT/Bearer/secret-kv/UUID/digit-gated-phone/generic-identifier patterns, fail-safe wrapper); added `getAiSafeFirstName` |
| `server/src/services/googleAiStudio.ts` | Route current message + customer name through the shared sanitizer in both prompt builders |
| `server/src/services/whatsappAgentPrompt.ts` | Route latest message, recent messages, and customer name through the shared sanitizer |
| `server/src/services/whatsappStepAwareNlu.ts` | Route the step-aware classifier's user text through the shared sanitizer |
| `server/src/tests/aiPrivacyBoundary.test.ts` | Extended from 15 to 36 tests (see §5) |
| `server/package.json` | Added `test:ai-prompt-privacy` script; wired into the main `test` chain (this test file previously had **no** npm script at all — a pre-existing gap independently documented in `docs/program/TEST_OWNERSHIP.md` §6) |

No changes to `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/RISK_REGISTER.md`,
`docs/program/evidence/KVKK_FINAL_RECONCILIATION_20260726.md`, or `docs/program/LAUNCH_GATES.md`,
per the task's conflict-avoidance instruction — those are reconciled centrally.

---

## 5. Tests

`npm run test:ai-prompt-privacy` (`server/src/tests/aiPrivacyBoundary.test.ts`) — **36/36 passed.**
Covers, at minimum:

- Current/latest-message phone redaction (`extractAssistantInputWithGoogleAi`, `buildWhatsAppAgentPrompt`)
- Historical-message phone/email redaction (pre-existing, still passing)
- Email redaction
- UUID redaction
- Bearer/token and key=value credential redaction
- Full-name exclusion (`getAiSafeFirstName`, `extractAssistantInputWithGoogleAi`, `buildWhatsAppAgentPrompt`)
- Combined multilingual Turkish/French text
- Formatted French phone numbers (`06 12 34 56 78`, `+33 6 12 34 56 78`, `01 23 45 67 89`)
- Formatted Turkish phone numbers (`+90 532 123 45 67`, `0(532) 123 45 67`, `05321234567`)
- Malformed-but-identifier-like values (non-hex "UUID" shape, cuid-like string)
- WhatsApp path (native `resolveWhatsAppConversationAgentDecision`)
- Meta WhatsApp / Instagram path (shared `buildWhatsAppAgentPrompt` boundary — see §2 on why
  these are one path, not two)
- Step-aware NLU path (`resolveStepAwareWhatsAppIntent`, including the `awaiting_phone` step where
  `userText` *is* the raw phone number being provided)
- Provider error path (mocked 500 response; asserts the thrown error and any `console.error` calls
  never contain the raw PII that was in the request)
- No raw prompt logging (assertion embedded in the provider-error test)
- Useful intent retained after redaction (date phrase `27.07.2026`, time phrase `14:00`, and the
  Turkish booking phrase `randevu almak istiyorum` all verified to survive redaction unchanged)

**Verification commands run (in the worktree), all green:**

```
npm run typecheck                        # tsc --noEmit — 0 errors
npm run test:ai-prompt-privacy           # 36/36 passed
git diff --check                         # no whitespace/conflict-marker errors
```

**Directly affected existing suites re-run, all green (no regressions):**

```
npm run test:msg-safety                  # 36/36 — includes buildWhatsAppAgentPrompt smoke tests
npm run test:meta-wa                     # 62/62 — includes whatsappStepAwareNlu.test.ts
npm run test:instagram                   # 28/28 — includes instagramAssistantParity.test.ts
npm run test:agent                       # 245/245 — WhatsApp agent fallback evaluation fixtures
npm run test:safety                      # WhatsApp safety fixtures — all passed
npm run test:fixtures                    # WhatsApp conversation fixtures — all passed
npm run test:booking-flow-log-redaction  # 12/12 — logging-redaction regression backstop
```

One pre-existing test in `aiPrivacyBoundary.test.ts` (`sanitizeAiMessageHistory truncates message
body to maxTextLength`, using `'a'.repeat(500)`) broke transiently during implementation because
an early version of the generic-identifier catch-all matched a 100-character run of the same
letter. Fixed by requiring the catch-all to see at least one digit in the run (§3) — real
identifiers/tokens are always alnum mixes, not repeated single characters — and the full suite is
green with that fix in place.

---

## 6. Limitations

1. **Phone/date disambiguation is a heuristic, not a parser.** The digit-count gate (9–15 digits)
   correctly separates phone numbers from bare dates (≤8 digits) and times (≤4 digits) in every
   case tested, including combined Turkish/French text. A theoretical edge case remains:
   punctuation-free adjacency of a full date *and* a time in the same run (e.g. a date immediately
   followed by a space then a time, with nothing else breaking the character class between them)
   could in principle accumulate ≥9 digits and be misread as a phone number. This was deliberately
   not "fixed" further because doing so would require true date/time parsing inside a text
   sanitizer, which is out of scope for this fix; the deterministic parsers
   (`extractAssistantInputRuleBased`, `interpretTimeRequest`, the deterministic step handlers) are
   the primary date/time extraction path everywhere in this codebase — the AI paths touched here
   are documented, tested fallbacks, not the primary path (`docs/program/evidence/KVKK_FINAL_RECONCILIATION_20260726.md`
   §13, "Fallback/optionality: CLOSED_VERIFIED").
2. **All-letter credential strings (no digit) are not caught by the generic identifier catch-all.**
   The catch-all requires at least one digit (§3, §5) to avoid false-positiving on ordinary long
   text. A hypothetical all-alphabetic secret 20+ characters long that isn't a JWT/Bearer/key=value
   match would not be redacted by that specific rule. In practice, every credential format observed
   in this codebase (API keys, tokens, UUIDs, cuids) contains digits.
3. **Legal/vendor-level DPA and international-transfer review for Google/Meta remains open**
   (`KVKK-CRIT-002`) — this fix closes the code-level redaction gap only; it does not and cannot
   close the separate LEGAL-owned finding that no DPA/retention agreement exists with Google for
   the Generative Language API.
4. **CodeGraph was unavailable in this environment** (§1) — investigation used Grep/Read
   cross-referencing instead. This is a tooling substitution, not a scope reduction: every call
   site of `getGoogleAiStudioConfig`/the Gemini endpoint was traced by hand.

---

## 7. Production verification still required

This fix is code-level and test-verified only. Before this can be marked
`PRODUCTION_VERIFIED`, the following still need to happen (owned centrally per the task's
conflict-avoidance instructions, not by this branch):

1. Deploy to production and confirm live Gemini request bodies (e.g. via a temporary debug log
   reviewed and removed, or provider-side request inspection if available) contain no raw
   phone/email/UUID/token/full-name for a real inbound message on each of the three channels.
2. Reconcile this fix's status into `KVKK_FINAL_RECONCILIATION_20260726.md` §13/§17 (gap #2 /
   `AI-PROMPT-REDACTION-GAP-001`), `NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, and
   `LAUNCH_GATES.md` — explicitly out of scope for this branch per instructions.
3. The three LEGAL-owned findings in §6.3 remain open regardless of this fix's production
   verification status.
