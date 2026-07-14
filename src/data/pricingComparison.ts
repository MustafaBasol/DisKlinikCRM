/**
 * Structure of the detailed plan comparison table. Cell type is language-independent;
 * display strings (row labels, "text" cell values) live in the pricingPage i18n namespace
 * under comparison.rows.<rowKey>.label / .values.<plan>.
 */

export type ComparisonCellType = 'check' | 'cross' | 'text';

export interface ComparisonCell {
  type: ComparisonCellType;
}

export interface ComparisonRow {
  key: string;
  starter: ComparisonCell;
  professional: ComparisonCell;
  enterprise: ComparisonCell;
}

export interface ComparisonCategory {
  key: string;
  rows: ComparisonRow[];
}

const check: ComparisonCell = { type: 'check' };
const cross: ComparisonCell = { type: 'cross' };
const text: ComparisonCell = { type: 'text' };

export const comparisonCategories: ComparisonCategory[] = [
  {
    key: 'general',
    rows: [
      { key: 'clinicCount', starter: text, professional: text, enterprise: text },
      { key: 'users', starter: text, professional: text, enterprise: text },
      { key: 'practitioners', starter: text, professional: text, enterprise: text },
      { key: 'devices', starter: text, professional: text, enterprise: text },
    ],
  },
  {
    key: 'patientsAppointments',
    rows: [
      { key: 'activePatientCapacity', starter: text, professional: text, enterprise: text },
      { key: 'fileStorage', starter: text, professional: text, enterprise: text },
      { key: 'patientManagement', starter: check, professional: check, enterprise: check },
      { key: 'appointmentCalendar', starter: check, professional: check, enterprise: check },
    ],
  },
  {
    key: 'treatmentOps',
    rows: [
      { key: 'treatmentPlans', starter: check, professional: check, enterprise: check },
      { key: 'dentalChart', starter: check, professional: check, enterprise: check },
    ],
  },
  {
    key: 'finance',
    rows: [
      { key: 'financePaymentTracking', starter: check, professional: check, enterprise: check },
      { key: 'paymentPlans', starter: check, professional: check, enterprise: check },
    ],
  },
  {
    key: 'labInventory',
    rows: [
      { key: 'labManagement', starter: check, professional: check, enterprise: check },
      { key: 'inventoryManagement', starter: check, professional: check, enterprise: check },
    ],
  },
  {
    key: 'channels',
    rows: [
      { key: 'whatsappLine', starter: cross, professional: text, enterprise: text },
      { key: 'instagramAccount', starter: cross, professional: text, enterprise: text },
      { key: 'unifiedInbox', starter: cross, professional: check, enterprise: check },
    ],
  },
  {
    key: 'ai',
    rows: [
      { key: 'aiConversationQuota', starter: cross, professional: text, enterprise: text },
      { key: 'whatsappAiAssistant', starter: cross, professional: check, enterprise: check },
      { key: 'instagramAiAssistant', starter: cross, professional: check, enterprise: check },
    ],
  },
  {
    key: 'automation',
    rows: [
      { key: 'autoPatientFollowUp', starter: cross, professional: check, enterprise: check },
      { key: 'noShowFollowUp', starter: cross, professional: check, enterprise: check },
      { key: 'postTreatmentFollowUp', starter: cross, professional: check, enterprise: check },
      { key: 'checkupReminders', starter: cross, professional: check, enterprise: check },
      { key: 'pendingRequestFollowUp', starter: cross, professional: check, enterprise: check },
    ],
  },
  {
    key: 'reporting',
    rows: [
      { key: 'reportingDashboard', starter: check, professional: check, enterprise: check },
      { key: 'advancedReports', starter: cross, professional: check, enterprise: check },
      { key: 'aiUsageReports', starter: cross, professional: check, enterprise: check },
    ],
  },
  {
    key: 'integration',
    rows: [
      { key: 'apiWebhook', starter: cross, professional: cross, enterprise: check },
      { key: 'customIntegration', starter: cross, professional: cross, enterprise: check },
    ],
  },
  {
    key: 'support',
    rows: [
      { key: 'supportLevel', starter: text, professional: text, enterprise: text },
      { key: 'sla', starter: cross, professional: cross, enterprise: text },
    ],
  },
  {
    key: 'capacity',
    rows: [
      { key: 'setupFeePerClinic', starter: text, professional: text, enterprise: text },
    ],
  },
];
