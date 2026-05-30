import {
  BarChart3,
  Building2,
  CalendarDays,
  CheckSquare,
  CreditCard,
  History,
  Instagram,
  Layers3,
  MessageCircle,
  ShieldCheck,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface LandingCardItem {
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
}

export interface DashboardMetric {
  labelKey: string;
  value: string;
  change: string;
  tone: 'teal' | 'blue' | 'navy' | 'amber';
}

export interface BranchMetric {
  nameKey: string;
  appointments: string;
  patients: string;
  collections: string;
  noShow: string;
  occupancy: number;
}

export interface IntegrationChannel {
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
  detailKeys: string[];
  tone: 'whatsapp' | 'instagram';
}

export const heroHighlights = [
  'hero.highlights.roles',
  'hero.highlights.branches',
  'hero.highlights.channels',
  'hero.highlights.reporting',
];

export const dashboardMetrics: DashboardMetric[] = [
  { labelKey: 'dashboard.metrics.appointments', value: '42', change: '+8%', tone: 'blue' },
  { labelKey: 'dashboard.metrics.patients', value: '12', change: '+4', tone: 'teal' },
  { labelKey: 'dashboard.metrics.collections', value: '₺86.400', change: '+12%', tone: 'navy' },
  { labelKey: 'dashboard.metrics.noShow', value: '%7,8', change: '-1,2', tone: 'amber' },
];

export const branchMetrics: BranchMetric[] = [
  {
    nameKey: 'multiClinic.branches.center',
    appointments: '42',
    patients: '12',
    collections: '₺86.400',
    noShow: '%4,8',
    occupancy: 91,
  },
  {
    nameKey: 'multiClinic.branches.atasehir',
    appointments: '29',
    patients: '9',
    collections: '₺62.300',
    noShow: '%6,1',
    occupancy: 78,
  },
  {
    nameKey: 'multiClinic.branches.bakirkoy',
    appointments: '35',
    patients: '11',
    collections: '₺71.900',
    noShow: '%5,3',
    occupancy: 84,
  },
];

export const problemItems: LandingCardItem[] = [
  { icon: CalendarDays, titleKey: 'problem.items.appointments.title', descriptionKey: 'problem.items.appointments.description' },
  { icon: History, titleKey: 'problem.items.history.title', descriptionKey: 'problem.items.history.description' },
  { icon: CreditCard, titleKey: 'problem.items.payments.title', descriptionKey: 'problem.items.payments.description' },
  { icon: UserX, titleKey: 'problem.items.noShow.title', descriptionKey: 'problem.items.noShow.description' },
];

export const featureItems: LandingCardItem[] = [
  { icon: CalendarDays, titleKey: 'features.items.appointments.title', descriptionKey: 'features.items.appointments.description' },
  { icon: History, titleKey: 'features.items.patientHistory.title', descriptionKey: 'features.items.patientHistory.description' },
  { icon: CreditCard, titleKey: 'features.items.collections.title', descriptionKey: 'features.items.collections.description' },
  { icon: UserX, titleKey: 'features.items.noShow.title', descriptionKey: 'features.items.noShow.description' },
  { icon: Building2, titleKey: 'features.items.branches.title', descriptionKey: 'features.items.branches.description' },
  { icon: CheckSquare, titleKey: 'features.items.tasks.title', descriptionKey: 'features.items.tasks.description' },
];

export const integrationProofPoints = [
  'integrations.points.connection',
  'integrations.points.inbox',
  'integrations.points.workflow',
];

export const integrationChannels: IntegrationChannel[] = [
  {
    icon: MessageCircle,
    titleKey: 'integrations.channels.whatsapp.title',
    descriptionKey: 'integrations.channels.whatsapp.description',
    detailKeys: [
      'integrations.channels.whatsapp.details.connections',
      'integrations.channels.whatsapp.details.inbox',
      'integrations.channels.whatsapp.details.branches',
    ],
    tone: 'whatsapp',
  },
  {
    icon: Instagram,
    titleKey: 'integrations.channels.instagram.title',
    descriptionKey: 'integrations.channels.instagram.description',
    detailKeys: [
      'integrations.channels.instagram.details.connections',
      'integrations.channels.instagram.details.inbox',
      'integrations.channels.instagram.details.conversion',
    ],
    tone: 'instagram',
  },
];

export const workflowItems: LandingCardItem[] = [
  { icon: Users, titleKey: 'workflow.items.setup.title', descriptionKey: 'workflow.items.setup.description' },
  { icon: Layers3, titleKey: 'workflow.items.operations.title', descriptionKey: 'workflow.items.operations.description' },
  { icon: BarChart3, titleKey: 'workflow.items.performance.title', descriptionKey: 'workflow.items.performance.description' },
];

export const trustItems: LandingCardItem[] = [
  { icon: ShieldCheck, titleKey: 'trust.items.roles.title', descriptionKey: 'trust.items.roles.description' },
  { icon: Building2, titleKey: 'trust.items.separation.title', descriptionKey: 'trust.items.separation.description' },
  { icon: Layers3, titleKey: 'trust.items.architecture.title', descriptionKey: 'trust.items.architecture.description' },
  { icon: ShieldCheck, titleKey: 'trust.items.compliance.title', descriptionKey: 'trust.items.compliance.description' },
];

export const faqItems = [
  'smallClinics',
  'branches',
  'roles',
  'migration',
  'integrations',
  'demo',
] as const;
