# Agent Start Prompt

Use this prompt when starting work with a coding agent.

```md
You are building a Health CRM MVP for dental clinics and small health centers.

Before coding, read these files:

- AGENTS.md
- README.md
- docs/01-product-brief.md
- docs/02-mvp-scope.md
- docs/03-user-roles-permissions.md
- docs/04-data-model.md
- docs/05-modules-and-pages.md
- docs/06-appointment-workflow.md
- docs/07-messaging-reminders.md
- docs/08-security-gdpr-health-data.md
- docs/09-development-roadmap.md
- docs/10-agent-task-list.md
- docs/11-ui-design-guidelines.md

Follow the roadmap strictly.

Start with project setup, authentication, clinic workspace, database schema, and patient CRUD.

Do not implement non-MVP features.

Do not add diagnosis, prescription, medical imaging, insurance, laboratory, or AI medical features.

Keep the MVP focused on:

- Patients
- Appointments
- Calendar
- Follow-up tasks
- Treatment/service pipeline
- Payments
- Message templates
- Dashboard
- Role-based permissions
- Activity logs

Use the UI style described in docs/11-ui-design-guidelines.md.

After each phase, summarize what was implemented and what files were changed.
```

## Recommended First Command

```md
Read all project documentation files. Then create a technical implementation plan for Phase 0 and Phase 1 only. Do not code yet.
```

## Recommended Second Command

```md
Implement Phase 0 and Phase 1 according to the documentation. Keep the code modular and MVP-focused.
```
