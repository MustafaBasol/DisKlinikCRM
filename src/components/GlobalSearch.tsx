import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  User,
  Calendar,
  CalendarPlus,
  Stethoscope,
  X,
  Loader2,
  LayoutDashboard,
  CheckSquare,
  BarChart3,
  BarChart2,
  Settings as SettingsIcon,
  Users as UsersIcon,
  UserPlus,
  Inbox as InboxIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, appointmentService, treatmentCaseService } from '../services/api';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { useAuth } from '../context/AuthContext';
import {
  canViewPatients,
  canViewAppointments,
  canViewFinanceDashboard,
  canViewPayments,
  canViewReports,
  canViewUsers,
  canCreatePatient,
  canCreateAppointment,
  canViewWhatsAppInbox,
  canViewInstagramInbox,
} from '../utils/permissions';

// Permitted if the unified /inbox shell would admit the user to either
// channel it wraps — mirrors Inbox.tsx's own redirect logic (UX-001 Wave 2).
const canOpenInbox = (user: any) => canViewWhatsAppInbox(user) || canViewInstagramInbox(user);

type EntityKind = 'patient' | 'appointment' | 'treatment';
type FlatKind = EntityKind | 'page' | 'action';

interface FlatItem {
  key: string;
  kind: FlatKind;
  title: string;
  subtitle: string;
  path: string;
  icon: React.ReactNode;
  badge?: string;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

// Static, permission-gated in-app destinations. Mirrors the same capability
// checks MainLayout.tsx uses to build its sidebar — see that file for the
// canonical permission mapping. Dashboard and Settings have no dedicated
// permission function (MainLayout always shows them), so they're unguarded.
interface PageDef {
  id: string;
  labelKey: string;
  path: string;
  icon: React.ReactNode;
  permission?: (user: any) => boolean;
}

const PAGE_DEFS: PageDef[] = [
  { id: 'dashboard', labelKey: 'dashboard', path: '/dashboard', icon: <LayoutDashboard size={16} className="text-gray-400" /> },
  { id: 'patients', labelKey: 'patients', path: '/patients', icon: <User size={16} className="text-gray-400" />, permission: canViewPatients },
  { id: 'appointments', labelKey: 'appointments', path: '/appointments', icon: <Calendar size={16} className="text-gray-400" />, permission: canViewAppointments },
  { id: 'treatmentCases', labelKey: 'treatmentCases', path: '/treatment-cases', icon: <Stethoscope size={16} className="text-gray-400" />, permission: canViewPatients },
  { id: 'tasks', labelKey: 'tasks', path: '/tasks', icon: <CheckSquare size={16} className="text-gray-400" />, permission: canViewPatients },
  { id: 'financeDashboard', labelKey: 'financeDashboard', path: '/finance', icon: <BarChart3 size={16} className="text-gray-400" />, permission: canViewFinanceDashboard },
  { id: 'reports', labelKey: 'reports', path: '/reports', icon: <BarChart2 size={16} className="text-gray-400" />, permission: canViewReports },
  { id: 'settings', labelKey: 'settings', path: '/settings', icon: <SettingsIcon size={16} className="text-gray-400" /> },
  { id: 'users', labelKey: 'users', path: '/users', icon: <UsersIcon size={16} className="text-gray-400" />, permission: canViewUsers },
];

// Permission-gated quick actions. Every target route below already exists in
// App.tsx today — none are invented. Each action only navigates (no modals).
interface ActionDef {
  id: string;
  labelKey: string;
  path: string;
  icon: React.ReactNode;
  permission: (user: any) => boolean;
}

const ACTION_DEFS: ActionDef[] = [
  { id: 'newPatient', labelKey: 'globalSearch.actions.newPatient', path: '/patients', icon: <UserPlus size={16} className="text-gray-400" />, permission: canCreatePatient },
  { id: 'newAppointment', labelKey: 'globalSearch.actions.newAppointment', path: '/appointments', icon: <CalendarPlus size={16} className="text-gray-400" />, permission: canCreateAppointment },
  { id: 'openCalendar', labelKey: 'globalSearch.actions.openCalendar', path: '/appointments', icon: <Calendar size={16} className="text-gray-400" />, permission: canViewAppointments },
  { id: 'openInbox', labelKey: 'globalSearch.actions.openInbox', path: '/inbox', icon: <InboxIcon size={16} className="text-gray-400" />, permission: canOpenInbox },
  { id: 'openFinance', labelKey: 'globalSearch.actions.openFinance', path: '/finance', icon: <BarChart3 size={16} className="text-gray-400" />, permission: canViewFinanceDashboard },
];

const MAX_PAGE_RESULTS = 5;
const MAX_ACTION_RESULTS = 5;

const matchesQuery = (label: string, q: string) => label.toLowerCase().includes(q.trim().toLowerCase());

const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [entityResults, setEntityResults] = useState<FlatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic request sequence guarding against an older in-flight entity
  // search resolving after a newer one and overwriting fresher results.
  const searchSeqRef = useRef(0);
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const { formatDate } = useClinicPreferences();
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isOpen) {
      searchSeqRef.current += 1;
      setQuery('');
      setEntityResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // UX-001-PROD-SMOKE-R2 (finding 3): close at the auth boundary itself
  // (authenticated -> unauthenticated) rather than reacting to the /login
  // route name — GlobalSearch is mounted independently of routing (see
  // App.tsx, which gates it on its own `searchOpen` state, not on location),
  // so a route change to /login alone would never unmount it. Bumping
  // searchSeqRef also means an entity search that was in flight when the
  // session ended can never land results (stale or otherwise) after this.
  useEffect(() => {
    if (!isAuthenticated) {
      searchSeqRef.current += 1;
      setQuery('');
      setEntityResults([]);
      setActiveIndex(0);
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const search = useCallback(async (q: string) => {
    const seq = ++searchSeqRef.current;
    if (q.trim().length < 2) {
      setEntityResults([]);
      return;
    }
    setLoading(true);

    // Entity search must stay permission-aware: an unauthorized role must
    // never issue the underlying list request at all (not merely have the
    // result hidden afterwards) — this mirrors the same capability checks
    // that gate the corresponding page in PAGE_DEFS above. Treatment cases
    // have no dedicated capability function; PAGE_DEFS gates that page on
    // canViewPatients too, so entity search mirrors it here.
    const canSearchPatientsClinical = canViewPatients(user);
    // UX-001-PROD-SMOKE-R2 (finding 1): BILLING is deliberately excluded from
    // canViewPatients (no clinical Patient Detail), but GET /patients already
    // authorizes BILLING and returns only patientListSelect fields (identity +
    // contact, no clinical data) — see server/src/routes/patients.ts. Reuse
    // that existing, already-minimized contract instead of inventing a new
    // endpoint; results route to /payments?patientId= (finding 1's mapping
    // below), never to the clinical /patients/:id detail route.
    const canSearchPatientsBillingSafe = !canSearchPatientsClinical && canViewPayments(user);
    const canSearchPatients = canSearchPatientsClinical || canSearchPatientsBillingSafe;
    const canSearchAppointments = canViewAppointments(user);
    const canSearchTreatments = canViewPatients(user);

    try {
      const [patientsRes, appointmentsRes, casesRes] = await Promise.allSettled([
        canSearchPatients ? patientService.getAll({ search: q, limit: 5 }) : Promise.resolve(null),
        canSearchAppointments ? appointmentService.getAll({ search: q, limit: 5 }) : Promise.resolve(null),
        canSearchTreatments ? treatmentCaseService.getAll({ search: q, limit: 5 }) : Promise.resolve(null),
      ]);

      // A newer keystroke already started another search while this one was
      // in flight — discard this stale response instead of overwriting it.
      if (seq !== searchSeqRef.current) return;

      const combined: FlatItem[] = [];

      if (canSearchPatients && patientsRes.status === 'fulfilled' && patientsRes.value) {
        const patients = Array.isArray(patientsRes.value.data)
          ? patientsRes.value.data
          : patientsRes.value.data?.data ?? [];
        patients.slice(0, 5).forEach((p: any) => {
          combined.push({
            key: `patient-${p.id}`,
            kind: 'patient',
            title: `${p.firstName} ${p.lastName}`,
            subtitle: p.phone || p.email || '',
            // BILLING-safe results never link to the clinical Patient Detail
            // route — they route to the existing /payments patientId filter
            // instead (Payments.tsx already reads it to prefilter the list).
            path: canSearchPatientsClinical ? `/patients/${p.id}` : `/payments?patientId=${p.id}`,
            icon: <User size={16} className="text-blue-500" />,
            badge: t('globalSearch.types.patient'),
          });
        });
      }

      if (canSearchAppointments && appointmentsRes.status === 'fulfilled' && appointmentsRes.value) {
        const appointments = Array.isArray(appointmentsRes.value.data)
          ? appointmentsRes.value.data
          : appointmentsRes.value.data?.data ?? [];
        appointments.slice(0, 5).forEach((a: any) => {
          combined.push({
            key: `appointment-${a.id}`,
            kind: 'appointment',
            title: `${a.patient?.firstName ?? ''} ${a.patient?.lastName ?? ''}`.trim(),
            subtitle: `${a.appointmentType?.name ?? ''} — ${formatDate(a.startTime)}`,
            path: `/appointments/${a.id}`,
            icon: <Calendar size={16} className="text-emerald-500" />,
            badge: t('globalSearch.types.appointment'),
          });
        });
      }

      if (canSearchTreatments && casesRes.status === 'fulfilled' && casesRes.value) {
        const cases = Array.isArray(casesRes.value.data)
          ? casesRes.value.data
          : casesRes.value.data?.data ?? [];
        cases.slice(0, 5).forEach((c: any) => {
          combined.push({
            key: `treatment-${c.id}`,
            kind: 'treatment',
            title: c.title || `${c.patient?.firstName ?? ''} ${c.patient?.lastName ?? ''}`.trim(),
            subtitle: c.stage || '',
            path: `/treatment-cases/${c.id}`,
            icon: <Stethoscope size={16} className="text-violet-500" />,
            badge: t('globalSearch.types.treatment'),
          });
        });
      }

      setEntityResults(combined);
      setActiveIndex(0);
    } catch {
      // silent
    } finally {
      if (seq === searchSeqRef.current) setLoading(false);
    }
  }, [formatDate, t, user]);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  // Query changes (including the debounced entity search landing) always
  // reset the highlighted row back to the top of the combined list.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const pageItems = useMemo<FlatItem[]>(() => {
    const q = query.trim();
    const permitted = PAGE_DEFS.filter((def) => !def.permission || def.permission(user));
    const withLabels = permitted.map((def) => ({ def, label: t(def.labelKey) }));
    const filtered = q === ''
      ? withLabels
      : withLabels.filter(({ label }) => matchesQuery(label, q));
    return filtered.slice(0, MAX_PAGE_RESULTS).map(({ def, label }) => ({
      key: `page-${def.id}`,
      kind: 'page' as const,
      title: label,
      subtitle: '',
      path: def.path,
      icon: def.icon,
    }));
  }, [query, user, t]);

  const actionItems = useMemo<FlatItem[]>(() => {
    const q = query.trim();
    const permitted = ACTION_DEFS.filter((def) => def.permission(user));
    const withLabels = permitted.map((def) => ({ def, label: t(def.labelKey) }));
    const filtered = q === ''
      ? withLabels
      : withLabels.filter(({ label }) => matchesQuery(label, q));
    return filtered.slice(0, MAX_ACTION_RESULTS).map(({ def, label }) => ({
      key: `action-${def.id}`,
      kind: 'action' as const,
      title: label,
      subtitle: '',
      path: def.path,
      icon: def.icon,
    }));
  }, [query, user, t]);

  const groups = useMemo(() => {
    const byKind = (kind: EntityKind) => entityResults.filter((r) => r.kind === kind);
    return [
      { key: 'patients', label: t('patients'), items: byKind('patient') },
      { key: 'appointments', label: t('appointments'), items: byKind('appointment') },
      { key: 'treatments', label: t('treatmentCases'), items: byKind('treatment') },
      { key: 'pages', label: t('globalSearch.groups.pages'), items: pageItems },
      { key: 'actions', label: t('globalSearch.groups.actions'), items: actionItems },
    ].filter((g) => g.items.length > 0);
  }, [entityResults, pageItems, actionItems, t]);

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const handleSelect = (item: FlatItem) => {
    navigate(item.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatItems[activeIndex]) {
      handleSelect(flatItems[activeIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  let rowIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('globalSearch.ariaLabel')}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          {loading ? (
            <Loader2 size={18} className="text-gray-400 animate-spin shrink-0" />
          ) : (
            <Search size={18} className="text-gray-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            className="flex-1 outline-none text-sm text-gray-900 placeholder:text-gray-400 bg-transparent"
            placeholder={t('globalSearch.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={flatItems.length > 0}
            aria-controls="global-search-listbox"
            aria-activedescendant={flatItems[activeIndex] ? `global-search-option-${flatItems[activeIndex].key}` : undefined}
            aria-autocomplete="list"
          />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Results */}
        {flatItems.length > 0 && (
          <div className="max-h-96 overflow-y-auto py-2" role="listbox" id="global-search-listbox" aria-label={t('globalSearch.ariaLabel')}>
            {groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.label}>
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400" aria-hidden="true">
                  {group.label}
                </div>
                <ul>
                  {group.items.map((item) => {
                    rowIndex += 1;
                    const i = rowIndex;
                    return (
                      <li key={item.key} role="presentation">
                        <button
                          id={`global-search-option-${item.key}`}
                          role="option"
                          aria-selected={i === activeIndex}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            i === activeIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                          }`}
                          onClick={() => handleSelect(item)}
                          onMouseEnter={() => setActiveIndex(i)}
                        >
                          {item.icon}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                            {item.subtitle && (
                              <p className="text-xs text-gray-500 truncate">{item.subtitle}</p>
                            )}
                          </div>
                          {item.badge && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 shrink-0">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {query.length >= 2 && !loading && flatItems.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            {t('globalSearch.noResults', { query })}
          </div>
        )}

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-400">
          <span><kbd className="font-mono bg-white border border-gray-200 px-1.5 py-0.5 rounded text-[10px]">↑↓</kbd> {t('globalSearch.navigate')}</span>
          <span><kbd className="font-mono bg-white border border-gray-200 px-1.5 py-0.5 rounded text-[10px]">Enter</kbd> {t('globalSearch.select')}</span>
          <span><kbd className="font-mono bg-white border border-gray-200 px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> {t('close')}</span>
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
