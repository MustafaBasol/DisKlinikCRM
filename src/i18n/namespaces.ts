export const NS = {
  COMMON: 'common',
  AUTH: 'auth',
  DASHBOARD: 'dashboard',
  PATIENTS: 'patients',
  APPOINTMENTS: 'appointments',
  SETTINGS: 'settings',
  SERVICES: 'services',
  INSURANCE: 'insurance',
  VALIDATION: 'validation',
  ERRORS: 'errors',
} as const;

export type Namespace = typeof NS[keyof typeof NS];
