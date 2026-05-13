# i18n Strategy - Health CRM

This document outlines the multilingual architecture and internationalization strategy for the Health CRM project.

## Supported Languages
- **English (en)** - Primary / Default
- **Turkish (tr)**
- **French (fr)**
- **German (de)**

## Namespace Structure
We use `react-i18next` with a namespace-based organization to keep translation files maintainable.
Files are located in `src/locales/{{lng}}/`.

| Namespace | Purpose |
|-----------|---------|
| `common` | Shared UI elements (buttons, nav, roles, languages) |
| `auth` | Login, Registration, Session management |
| `dashboard`| Stats, Charts, Activity feed |
| `patients` | Patient list, Profile, Form, Statuses |
| `appointments`| Schedule, Calendar, Appointment statuses |
| `settings` | User and Clinic settings |
| `validation`| Form validation messages |
| `errors` | API and System error messages |

## Key Naming Rules
- Use `camelCase` for keys.
- Nested objects are encouraged for grouping (e.g., `list.name`, `status.active`).
- For enums, use the slug as the key (e.g., `source.google`).

## Enum Translation Strategy
- **Backend**: Always stores and returns stable English slugs (e.g., `patientStatus: 'active'`).
- **Frontend**: Translates labels using the slug as a sub-key:
  ```tsx
  t(`patients:status.${patient.patientStatus}`)
  ```

## Backend Error Code Strategy
Backend returns simple error objects with a stable `code`:
```json
{ "error": "Patient not found", "code": "PATIENT_NOT_FOUND" }
```
Frontend maps these codes in `errors.json`:
```json
{ "PATIENT_NOT_FOUND": "Hasta bulunamadı." }
```

## How to Add a New Language
1. Create a new directory in `src/locales/{{new_lng}}/`.
2. Add the required JSON files (copying from `en` is recommended).
3. Update `src/i18n/config.ts`:
   - Import the new JSON files.
   - Add the language to `supportedLngs`.
   - Add the resource mapping.
4. Update `src/layouts/MainLayout.tsx` language switcher array.

## How to Add Translations for a New Module
1. Define a new namespace in `src/i18n/namespaces.ts`.
2. Create `{{namespace}}.json` in all supported language folders.
3. Import and add to `src/i18n/config.ts`.
4. Use `useTranslation(['namespace'])` in your components.
