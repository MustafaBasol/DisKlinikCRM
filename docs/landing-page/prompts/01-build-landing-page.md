# Antigravity Ana Prompt — Dental Clinic CRM Landing Page

You are a senior frontend engineer and product designer. Build a modern, conversion-focused landing page for a Dental Clinic CRM SaaS product.

## Context

The product is a CRM/operations platform for dental clinics. It helps clinics manage:

- Patients
- Appointments
- Treatment plans
- Payments and collections
- Tasks
- No-show and cancellation analysis
- Multi-clinic ownership and branch comparison
- Role-based access for clinic teams

The product may later support multiple clinics under one owner account. The landing page must clearly communicate that a clinic owner can manage and compare multiple clinics from one central panel.

## Important constraints

- Do not break the existing application.
- First inspect the repository structure.
- Respect the current framework and conventions.
- If the app uses Next.js App Router, create the landing page in a clean route structure.
- Keep all landing page components isolated under a dedicated folder such as `src/components/landing`.
- Avoid unnecessary package installation.
- Avoid backend/database changes.
- Do not modify auth, Prisma, API, or dashboard logic unless strictly necessary.
- Use TypeScript and keep code clean.
- Use responsive design.
- Use accessible HTML structure.
- Make sure build and lint pass if scripts exist.

## Visual direction

Create a premium, clean, trustworthy B2B SaaS landing page with a dental/medical CRM feel.

Use this palette unless the current project already has a strong design system:

- Background: `#F8FAFC`
- Surface: `#FFFFFF`
- Primary navy: `#0F2742`
- Medical teal: `#0E9384`
- Soft cyan: `#E6FFFA`
- Accent blue: `#2563EB`
- Text dark: `#102033`
- Text muted: `#667085`
- Border: `#E5E7EB`
- Success: `#12B76A`
- Warning: `#F79009`
- Error: `#F04438`

Design style:

- Modern SaaS
- Clean medical trust
- Large whitespace
- Rounded cards
- Soft shadows
- Dashboard mockup instead of stock photos
- Minimal icons
- Strong CTA
- Mobile-first responsiveness

Avoid:

- Overly generic dental stock photos
- Too much bright blue
- Cartoon visuals
- Heavy gradients
- Claims that cannot be proven
- Legal overpromising around KVKK/GDPR compliance

## Required page sections

1. Header
   - Logo/product name placeholder
   - Navigation anchors
   - CTA button: “Demo Talep Et”

2. Hero
   - Eyebrow: “Diş Klinik CRM”
   - Main headline: “Kliniğinizi tek panelden yönetin”
   - Supporting text: mention patients, appointments, treatments, payments, tasks, and branch performance
   - CTA buttons:
     - “Demo Talep Et”
     - “Özellikleri İncele”
   - Right side: dashboard mockup with cards for appointments, no-show rate, revenue/collections, and multi-clinic comparison

3. Problem section
   - Show the operational pain of scattered clinic workflows

4. Feature grid
   - Appointment management
   - Patient and treatment history
   - Payment and collection tracking
   - No-show and cancellation analysis
   - Multi-clinic management
   - Team tasks and performance

5. Multi-clinic owner panel section
   - This is a key differentiator.
   - Show 3 sample clinics compared side by side.
   - Metrics: appointment count, revenue/collections, new patients, no-show rate, occupancy/performance

6. Workflow section
   - 3 steps:
     1. Define clinic and team
     2. Manage patients, appointments and treatments
     3. Track performance from dashboard

7. Trust/architecture section
   - Role-based access
   - Clinic-level data separation
   - Modular SaaS architecture
   - API-ready integrations
   - Phrase compliance carefully: “KVKK/GDPR uyum süreçlerine göre yapılandırılabilir”

8. Demo CTA section
   - Short persuasive text
   - CTA button
   - Optional form mockup fields:
     - Name
     - Clinic name
     - City
     - Number of branches
     - Email/phone

9. FAQ
   - Small clinics
   - Multi-clinic support
   - User roles
   - Data migration
   - WhatsApp/SMS integrations
   - Demo/early access

10. Footer
   - Product name
   - Short description
   - Links placeholders

## Copy language

Use Turkish copy. Tone must be professional, clear, and trustworthy. Avoid exaggerated startup buzzwords.

## Implementation details

Create reusable components. Suggested structure:

```txt
src/components/landing/
  LandingPage.tsx
  LandingHeader.tsx
  HeroSection.tsx
  DashboardMockup.tsx
  ProblemSection.tsx
  FeatureGrid.tsx
  MultiClinicSection.tsx
  WorkflowSection.tsx
  TrustSection.tsx
  DemoCtaSection.tsx
  FaqSection.tsx
  LandingFooter.tsx
src/data/landing.ts
```

Adapt paths to the existing project.

## Final response after implementation

Report:

- Files created
- Files modified
- Route URL
- Build/lint result
- Any assumptions made
- Any TODOs left intentionally
