# UI Design Guidelines

## Design Direction

Use a clean SaaS dashboard style inspired by Comptario's current interface:

- White background
- Light gray page canvas
- Soft card borders
- Rounded cards
- Blue primary actions
- Green success actions
- Red danger/expense actions
- Purple accent for documents or reminders
- Orange accent for products/services
- Left sidebar navigation
- Top action bar
- Card-based dashboard

## Why This Direction

The Comptario visual style is a good starting point because it already feels:

- Professional
- Familiar
- Business-oriented
- Easy to understand
- Suitable for admin dashboards
- Lightweight and not overly medical

For a health CRM, the same structure can work well, but the tone should be slightly more clinical and calm.

## Recommended Adjustments for Health CRM

### Keep

- Left sidebar layout
- Top search bar
- Quick action buttons
- Metric cards
- White cards with soft shadows/borders
- Blue as the primary brand color
- Green for positive/completed actions
- Red for cancelled/no-show/overdue states
- Purple for reminders/messages
- Orange for service/treatment opportunities

### Change

- Reduce overly bright gradients
- Use more calm blue/teal tones
- Increase spacing in patient and appointment pages
- Make calendar and patient detail pages more readable
- Use fewer financial-looking widgets on the first screen
- Add appointment and patient-first dashboard metrics

## Suggested Color Tokens

Primary:

- `#2563EB` blue
- `#1D4ED8` darker blue
- `#EFF6FF` light blue background

Health accent:

- `#0D9488` teal
- `#CCFBF1` light teal background

Success:

- `#16A34A` green
- `#DCFCE7` light green background

Warning:

- `#F59E0B` amber
- `#FEF3C7` light amber background

Danger:

- `#DC2626` red
- `#FEE2E2` light red background

Purple accent:

- `#7C3AED` purple
- `#F3E8FF` light purple background

Neutral:

- `#F8FAFC` page background
- `#FFFFFF` card background
- `#E5E7EB` border
- `#111827` heading text
- `#6B7280` secondary text

## Suggested Sidebar Items

- Dashboard
- Patients
- Appointments
- Calendar
- Treatment / Services
- Tasks
- Payments
- Messages
- Reports
- Settings

## Dashboard Layout

Top metric cards:

1. Today's Appointments
2. New Patients
3. No-Shows
4. Pending Follow-Ups
5. Open Treatment Value

Main area:

- Left: Weekly appointment chart or calendar preview
- Right: Quick actions

Quick actions:

- New Patient
- New Appointment
- New Follow-Up Task
- New Treatment Case
- Add Payment
- Send Reminder

Secondary cards:

- Pending tasks
- Upcoming appointments
- Open treatment cases
- Overdue payments

## Important UX Rules

- The user should reach the create appointment screen in one click.
- Patient search should be visible and fast.
- Every patient detail page should show next appointment clearly.
- No-show and overdue states should be visually obvious.
- Avoid cluttering the dashboard with too many financial metrics.
- Use calm and trustworthy visuals, not hospital-heavy or overly medical visuals.

## Component Style

Cards:

- Rounded corners: 12px to 16px
- Border: light gray
- Shadow: subtle or none
- Padding: 20px to 24px

Buttons:

- Primary button: blue
- Success button: green
- Danger button: red
- Secondary button: white with border

Tables:

- Clean row spacing
- Search and filters above table
- Status badges
- Sticky action column if needed

Forms:

- Use two-column layout on desktop
- Use clear labels
- Add required field indicators
- Keep medical/sensitive fields minimal in MVP
