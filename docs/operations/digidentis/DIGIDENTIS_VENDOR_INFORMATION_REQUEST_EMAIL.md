# DIGIDENTIS_VENDOR_INFORMATION_REQUEST_EMAIL — Copy-Ready Draft

**Purpose:** send to DigiDentiS support before any real clinic is activated. Fill in the bracketed placeholders, then send from a NoraMedi-controlled mailbox. **Do not attach or paste any Client Secret, Webhook Secret, or real patient data in this email or any reply thread.**

**Contact addresses found in the vendor's own v3.2.0 documentation (verify which is current before sending — see note below):**
- `destek@digidentis.com` (given in §7.10, for treatment-type "API Visible" assistance)
- `digidentis@gmail.com` (given in the document's final "Support" section, for general technical/integration support)

A personal-domain (`gmail.com`) address as the primary listed support contact for an "Enterprise docs · Partner Confidential" API is unusual — ask the vendor to confirm their current, authoritative support channel as the first line of the email, and prefer whichever they confirm going forward.

---

## Subject

`NoraMedi <-> DigiDentiS Takvim API v3.2.0 — Integration activation questions (pre-production)`

## Body

```
Hello,

We're NoraMedi, a dental-clinic management platform (noramedi.com). We've built
our integration against your Takvim API v3.2.0 documentation (HMAC-SHA256
per-request signing, /Api/v1/external_booking base path) and are preparing to
activate it for our first clinic. Before we do, we'd like to confirm a few
points with your team:

1. Support contact confirmation
   Your v3.2.0 documentation lists two different support addresses
   (destek@digidentis.com in section 7.10, digidentis@gmail.com in the final
   Support section). Could you confirm which is the correct, current channel
   for integration support going forward?

2. IP whitelisting
   Per section 2 of your documentation, all API requests must originate from
   pre-approved IP addresses. Please let us know the process to register our
   production server's outbound IP address(es), and whether IPs can be
   updated/rotated later (e.g. if we migrate hosting) without re-onboarding.
   [We will supply the actual IP address separately, once confirmed live —
   see our internal runbook step 3.5.]

3. Webhook registration and topology
   Section 11 of your documentation states webhooks are "opt-in and
   configured per integrator by the DigiDentiS team." Could you clarify:
   a. Is the webhook URL, secret, and event subscription list configured
      once per integrator account (i.e. one URL for all of our clinics), or
      can each of our clinics have its own distinct webhook URL registered
      under the same integrator account?
   b. If it is one URL per integrator: will webhook payloads for different
      clinics under our account all arrive at that single URL (using the
      payload's own clinic_id field to distinguish them), or is a separate
      integrator account required per clinic?
   This affects how we roll out additional clinics after our first pilot, so
   we'd like to confirm before registering our first webhook URL.

4. Webhook event activation
   We'd like to subscribe to all currently available event types
   (appointment.created, appointment.cancelled, appointment.rescheduled) now,
   and to the reserved types (appointment.confirmed, appointment.completed,
   appointment.no_show) as well, per your documentation's note that reserved
   events "may be enabled progressively" and integrators should subscribe now
   so they receive them automatically once activated. Please confirm this is
   possible at initial webhook registration.

5. Sandbox / non-production environment
   Your documentation lists exactly one base URL, labeled "Production"
   (https://www.ddslogin.com/Api/v1/external_booking/), with no sandbox or
   staging environment documented. Can you confirm whether a sandbox/test
   environment exists that we could use for initial integration testing,
   instead of a live production clinic account? If none exists, what do you
   recommend for safe first-time testing against production (e.g. a
   dedicated test company/clinic account, test-only appointment data
   conventions, or a recommended low-traffic window)?

6. Clinic/company activation steps on your side
   Once we have a Client ID / Client Secret for a company, is there any
   additional activation step required on your side before our API calls
   will succeed for a specific clinic under that company (e.g. clinic-level
   enablement, plan/quota assignment)? We ask because your Get Company Quota
   endpoint (7.4) implies quota is tracked per company — we'd like to
   understand any limits before our first test run.

7. Treatment-type "API Visible" flag
   We understand from section 7.10 that treatment types must be individually
   marked "API Visible" (Settings > System > Customization) before
   GET /companies/{company_id}/treatment-types will return them. Can you
   confirm this is purely a self-service setting in your dashboard, or
   whether your team needs to enable it on our behalf for a new account?

Once we have answers to the above, we intend to run a single controlled test
clinic through the full integration (credential exchange, doctor/treatment-
type sync, one test appointment, webhook delivery verification) before
considering any wider rollout. We will not send you any real patient data
during this test phase.

Thank you — happy to hop on a call if that's easier for any of the above.

Best regards,
[Name]
[Role — NoraMedi]
[Direct contact email/phone]
```

---

## Sending checklist

- [ ] Confirmed current support address per point 1's answer before relying on either address long-term.
- [ ] No Client Secret, Webhook Secret, or real patient data anywhere in the sent email or thread.
- [ ] Sent from a NoraMedi-controlled mailbox that the decision owner can monitor (not a personal inbox).
- [ ] Reply logged/attached to the integration's tracking ticket once received.
