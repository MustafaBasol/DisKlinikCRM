/**
 * Deterministic add-on pricing for the /fiyatlandirma page.
 * Yearly amounts are explicit literals (not computed at runtime) so they always match
 * the "10 months paid, 12 months used" contractual rule exactly.
 */

export interface RecurringPackage {
  key: string;
  monthly: number;
  yearly: number;
}

/** Additional AI conversation packages, on top of the Akıllı Klinik 500/mo quota. */
export const aiPackages: (RecurringPackage & { extraQuota: number })[] = [
  { key: 'aiMini', extraQuota: 250, monthly: 490, yearly: 4900 },
  { key: 'aiPlus', extraQuota: 500, monthly: 890, yearly: 8900 },
  { key: 'aiGrowth', extraQuota: 1000, monthly: 1590, yearly: 15900 },
  { key: 'aiScale', extraQuota: 2500, monthly: 3490, yearly: 34900 },
];

/** Additional general-purpose file storage packages (excludes imaging/DICOM). */
export const storagePackages: (RecurringPackage & { extraGb: number })[] = [
  { key: 'storage25', extraGb: 25, monthly: 290, yearly: 2900 },
  { key: 'storage50', extraGb: 50, monthly: 490, yearly: 4900 },
  { key: 'storage100', extraGb: 100, monthly: 790, yearly: 7900 },
  { key: 'storage250', extraGb: 250, monthly: 1490, yearly: 14900 },
];

/** Additional active-patient capacity packages. */
export const patientCapacityPackages: (RecurringPackage & { extraPatients: number })[] = [
  { key: 'capacity5k', extraPatients: 5000, monthly: 490, yearly: 4900 },
  { key: 'capacity10k', extraPatients: 10000, monthly: 790, yearly: 7900 },
];

export interface ChannelAddon {
  key: string;
  monthly: number;
  setupFee: number;
}

export const channelAddons: ChannelAddon[] = [
  { key: 'whatsappLine', monthly: 990, setupFee: 2500 },
  { key: 'instagramAccount', monthly: 590, setupFee: 1500 },
  { key: 'webChatbot', monthly: 1490, setupFee: 5000 },
];

export interface SmsCreditPackage {
  key: string;
  smsCount: number;
  price: number;
}

/**
 * NoraMedi SMS credit packages. All SMS sending goes through NoraMedi — clinics do not
 * connect their own SMS provider account. Packages are one-time credit purchases, independent
 * of the monthly/yearly subscription billing period.
 */
export const smsPackages: SmsCreditPackage[] = [
  { key: 'smsMini', smsCount: 500, price: 290 },
  { key: 'smsStandard', smsCount: 1000, price: 490 },
  { key: 'smsPlus', smsCount: 3000, price: 1290 },
  { key: 'smsBulk', smsCount: 10000, price: 3490 },
];

export const setupFees = {
  starter: 5000,
  professional: 10000,
  enterpriseCentral: 20000,
  enterprisePerClinic: 10000,
  enterpriseMinimum: 40000,
};

export const migrationPackages = {
  basic: 5000,
  standard: 12500,
  advancedFrom: 25000,
};

export const trainingServices = {
  onlineExtraTwoHours: 2500,
  onSiteOneDay: 15000,
  customReportFrom: 5000,
  customAutomationFrom: 7500,
};
