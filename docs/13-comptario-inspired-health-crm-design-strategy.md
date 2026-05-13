# Design Strategy: Comptario-Inspired Health CRM UI

## Purpose

This document defines the recommended visual direction for the Health CRM MVP.

The design should be inspired by the current Comptario dashboard style, but adapted for health centers, dental clinics, and appointment-based clinic operations.

The goal is to create a product that feels:

- Professional
- Clean
- Trustworthy
- Calm
- Easy to use
- Familiar for business users
- Suitable for clinical operations

## Main Design Decision

Use the Comptario layout and dashboard structure as the foundation.

Do not create a completely different visual system for the MVP.

Instead, create a health-focused version of the Comptario design language.

## Why Use the Comptario Style?

The Comptario interface already has several strong qualities:

- Clear left sidebar navigation
- Simple dashboard cards
- Professional SaaS look
- Good use of white space
- Strong primary action buttons
- Clean card-based layout
- Easy-to-understand quick actions
- Familiar business application structure

These qualities are also suitable for a clinic CRM.

A health CRM does not need to look like a hospital system from the beginning. It should look modern, operational, and easy for receptionists, doctors, and clinic owners to use.

## What Should Stay Similar to Comptario?

The following design elements should be kept:

### Layout

- Left sidebar navigation
- Top action bar
- Main dashboard area
- Card-based sections
- Quick action cards
- Search field in the header
- User/profile area in the top right

### Dashboard Structure

Keep a similar dashboard pattern:

- Top KPI cards
- Main analytics/chart section
- Quick actions section
- Secondary summary cards
- Operational shortcuts

### Visual Style

- White cards
- Light gray page background
- Rounded corners
- Subtle borders
- Soft shadows
- Icon-based navigation
- Color-coded actions

## What Should Change for Health CRM?

The Comptario interface is finance-oriented. The Health CRM should feel more clinical and patient-operation focused.

### Reduce Financial Emphasis

Comptario dashboard metrics focus on:

- Total revenue
- VAT
- Expenses
- Invoices
- Customers

Health CRM dashboard metrics should focus on:

- Today's appointments
- New patients
- No-shows
- Pending follow-ups
- Open treatment/service opportunities
- Pending payments

### Use Calmer Colors

The current Comptario colors are strong and energetic. For healthcare, use slightly softer tones.

The interface should feel calm and trustworthy, not aggressive.

### Make Patient and Appointment Actions More Prominent

In Comptario, financial actions are prominent.

In Health CRM, the main quick actions should be:

- New Patient
- New Appointment
- New Follow-Up
- New Treatment Case
- Add Payment
- Send Reminder

## Recommended Color System

### Primary Blue

Use blue as the main brand/action color.

```css
--color-primary: #2563EB;
--color-primary-dark: #1D4ED8;
--color-primary-light: #EFF6FF;
```

Usage:

- Main buttons
- Active sidebar item
- Primary icons
- Main dashboard indicators

### Health Teal

Use teal as the health/clinic accent color.

```css
--color-health: #0D9488;
--color-health-dark: #0F766E;
--color-health-light: #CCFBF1;
```

Usage:

- Appointments
- Patient-related highlights
- Completed visit states
- Calm clinical accents

### Success Green

```css
--color-success: #16A34A;
--color-success-light: #DCFCE7;
```

Usage:

- Completed appointments
- Accepted treatment cases
- Paid payments
- Positive dashboard metrics

### Warning Amber

```css
--color-warning: #F59E0B;
--color-warning-light: #FEF3C7;
```

Usage:

- Pending follow-ups
- Waiting patient decision
- Upcoming deadlines
- Partially paid cases

### Danger Red

```css
--color-danger: #DC2626;
--color-danger-light: #FEE2E2;
```

Usage:

- No-show
- Cancelled appointment
- Overdue task
- Failed reminder
- Unpaid overdue balance

### Purple Accent

```css
--color-purple: #7C3AED;
--color-purple-light: #F3E8FF;
```

Usage:

- Messages
- Reminder templates
- Sent notifications
- Documents

### Orange Accent

```css
--color-orange: #F97316;
--color-orange-light: #FFEDD5;
```

Usage:

- Treatment/service cases
- Offers
- Service opportunities

### Neutral Colors

```css
--color-page-bg: #F8FAFC;
--color-card-bg: #FFFFFF;
--color-border: #E5E7EB;
--color-heading: #111827;
--color-text: #374151;
--color-muted: #6B7280;
--color-subtle: #9CA3AF;
```

## Sidebar Design

The sidebar should follow the Comptario pattern.

### Recommended Sidebar Items

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

### Sidebar Rules

- Active item should use blue highlight.
- Icons should be simple and consistent.
- Sidebar should remain readable and uncluttered.
- Avoid too many menu items in the MVP.
- Use “Treatment / Services” instead of deeply medical terminology.

## Top Bar Design

The top bar should include:

- Page title
- Primary quick action button
- Search field
- Language selector if multilingual
- Notification icon
- User profile area

### Recommended Top Buttons

For the Health CRM MVP:

- `+ New Appointment`
- `+ New Patient`

Optional secondary:

- `+ New Task`

## Dashboard Layout

The dashboard should use a similar structure to Comptario but with clinic-specific content.

### Top KPI Cards

Recommended top cards:

1. Today's Appointments
2. New Patients
3. No-Shows
4. Pending Follow-Ups
5. Open Treatment Value

### Main Dashboard Section

Left side:

- Weekly appointment overview
- Appointment status summary
- Calendar preview

Right side:

- Quick actions
- Today's agenda
- Urgent follow-ups

### Quick Action Cards

Recommended quick actions:

- New Patient
- New Appointment
- New Follow-Up Task
- New Treatment Case
- Add Payment
- Send Reminder

### Secondary Cards

Recommended secondary cards:

- Pending tasks
- Upcoming appointments
- Open treatment/service cases
- Overdue payments
- Recent activity

## Page Design Rules

### Patient List Page

Should include:

- Search by name, phone, email
- Filter by status
- Filter by source
- Add patient button
- Clean table
- Status badges
- Next appointment column

Priority: Fast patient lookup.

### Patient Detail Page

Should include:

- Patient summary card
- Next appointment
- Contact information
- Consent status
- Appointment history
- Follow-up tasks
- Treatment/service cases
- Payment summary
- Activity timeline

Priority: Everything important about a patient should be visible quickly.

### Appointment Calendar Page

Should include:

- Day view
- Week view
- Practitioner filter
- Status filter
- Appointment type filter
- Color-coded appointments

Priority: Receptionist should understand the day at a glance.

### Treatment / Services Page

Should look like a pipeline or table.

Recommended stages:

- New
- Consultation Scheduled
- Consultation Done
- Quote Sent
- Waiting Patient Decision
- Accepted
- In Progress
- Completed
- Lost

Priority: Help clinics follow up with potential revenue opportunities.

### Tasks Page

Should include:

- My tasks
- All tasks
- Overdue tasks
- Due today
- Assigned user
- Patient link
- Status badge

Priority: Make follow-ups impossible to forget.

## Component Guidelines

### Cards

Use:

- White background
- Light border
- 12px to 16px border radius
- 20px to 24px padding
- Minimal shadow
- Clear title
- Icon area on the right or top

### Buttons

Primary:

- Blue background
- White text

Success:

- Green background
- White text

Danger:

- Red background
- White text

Secondary:

- White background
- Gray border
- Dark text

### Tables

Use:

- Clear header row
- Comfortable row height
- Search and filters above table
- Status badges
- Row actions on the right
- Pagination if needed

### Badges

Use badges for:

- Appointment status
- Patient status
- Payment status
- Task priority
- Treatment stage

Examples:

- Confirmed: blue or teal
- Completed: green
- No-show: red
- Pending: amber
- Cancelled: gray or red
- Paid: green
- Partial: amber
- Overdue: red

### Forms

Use:

- Clear labels
- Two-column layout on desktop
- Single-column layout on mobile
- Required field indicators
- Inline validation messages
- Save and cancel buttons at the bottom

## UX Priorities

The MVP should prioritize speed and clarity.

### The user should be able to:

- Create an appointment in one or two clicks
- Search a patient quickly
- See today's appointments immediately
- Identify no-shows clearly
- See overdue follow-ups clearly
- Create a task from a patient page
- See payment status without opening many screens

## What to Avoid

Avoid:

- Overly medical/hospital-heavy design
- Too many colors on the same screen
- Complex charts in MVP
- Dense tables with too many columns
- Overloading dashboard with financial metrics
- Using medical icons everywhere
- Making the app look like accounting software
- Making the app look like an electronic health record

## Brand Feeling

The interface should feel like:

> A modern clinic operations dashboard that helps small healthcare teams stay organized, reduce missed appointments, and follow up with patients professionally.

It should not feel like:

> A complex hospital management system.

It should also not feel like:

> A generic sales CRM with medical labels added later.

## Agent Implementation Instruction

When implementing the UI, follow these rules:

1. Use the Comptario-inspired dashboard structure.
2. Keep the left sidebar and top bar layout.
3. Use the health-specific color system defined in this file.
4. Replace finance-first dashboard metrics with clinic-first metrics.
5. Prioritize patients, appointments, tasks, and treatment/service follow-ups.
6. Use calm visual language.
7. Use reusable UI components.
8. Avoid adding complex non-MVP screens.
9. Keep empty states and loading states clean.
10. Make the interface demo-ready for dental clinic owners.

## First Dashboard Draft

The first dashboard should include:

### Top Row

- Today's Appointments
- New Patients
- No-Shows
- Pending Follow-Ups
- Open Treatment Value

### Main Left Section

- Weekly appointment overview
- Appointment status distribution

### Main Right Section

- Quick Actions
- Today's Agenda

### Bottom Section

- Overdue Follow-Ups
- Open Treatment Cases
- Recent Activity

## Recommended MVP Visual Direction

Final recommendation:

Use a Comptario-inspired SaaS dashboard layout, but adapt it with a calmer health-focused visual identity.

This is better than starting with a completely new design because:

- It saves development time.
- It keeps visual consistency with existing work.
- It gives the product a professional SaaS feel.
- It is easier for an agent to implement.
- It can later become a reusable design system for other vertical CRMs.
