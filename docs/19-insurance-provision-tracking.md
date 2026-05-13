# Insurance / Provision Tracking

This MVP module provides manual insurance and provision workflow tracking for Turkish clinics.

It helps staff track SGK, TSS, OSS, private insurance, corporate, and other approval processes without connecting to live insurance systems.

## Scope

- Create and update provision requests.
- Track provider name, type, policy number, provision number, status, requested amount, approved amount, patient responsibility amount, dates, rejection reason, notes, assignee, and creator.
- Link provision requests to a patient and optionally to a treatment case.
- Show insurance activity in patient and treatment case timelines.
- Allow billing/admin/reception teams to update status and financial approval fields.

## Explicit Non-Scope

This is not:

- SGK Medula integration.
- Private insurance API integration.
- E-invoice or accounting.
- VAT calculation.
- Prescription management.
- Diagnosis or medical record storage.

## Status Workflow

Allowed statuses:

- `draft`
- `pending_documents`
- `submitted`
- `waiting_response`
- `approved`
- `partially_approved`
- `rejected`
- `cancelled`

Rejected provisions require a rejection reason.

## RBAC

- Admin: manage all provision records in the clinic.
- Receptionist: create and update provision requests and operational status.
- Billing: view provisions and update financial approval fields/status.
- Doctor: view provisions related to assigned patients or treatment cases.

All records are scoped by `clinicId`.

## Future Integration Roadmap

Future live integrations should be added as separate adapter services, not embedded in the manual tracking workflow:

1. SGK Medula eligibility and provision lookup adapter.
2. Private insurer API adapters per provider.
3. Document checklist and attachment workflow.
4. Asynchronous integration logs and retry queue.
5. Reconciliation with billing/payment modules.

Before live integrations, confirm legal, security, audit logging, consent, and provider certification requirements.
