import React from 'react';
import { CheckCircle2, ChevronRight, Circle, Rocket, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useClinic } from '../context/ClinicContext';
import { normalizeRole } from '../utils/permissions';

const STEPS = [
  { key: 'clinic', link: '/settings' },
  { key: 'team', link: '/users' },
  { key: 'services', link: '/settings' },
  { key: 'patient', link: '/patients' },
  { key: 'appointment', link: '/appointments' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

interface ChecklistState {
  dismissed: boolean;
  done: StepKey[];
}

const defaultState: ChecklistState = { dismissed: false, done: [] };

// Onboarding progress is intentionally client-side only (localStorage) so the
// checklist needs no backend support and can be removed without migration.
const readState = (storageKey: string): ChecklistState => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    return {
      dismissed: Boolean(parsed.dismissed),
      done: Array.isArray(parsed.done) ? parsed.done.filter((k: unknown) => typeof k === 'string') : [],
    };
  } catch {
    return defaultState;
  }
};

const SetupChecklist: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { selectedClinicId } = useClinic();

  const storageKey = `noramedi:setup-checklist:${selectedClinicId || 'default'}`;
  const [state, setState] = React.useState<ChecklistState>(() => readState(storageKey));

  React.useEffect(() => {
    setState(readState(storageKey));
  }, [storageKey]);

  const role = user ? normalizeRole(user.role, user.canAccessAllClinics) : null;
  const canSee = role === 'OWNER' || role === 'ORG_ADMIN' || role === 'CLINIC_MANAGER';

  if (!canSee || state.dismissed) return null;

  const persist = (next: ChecklistState) => {
    setState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode etc.) — checklist still works for the session.
    }
  };

  const toggleStep = (key: StepKey) => {
    const done = state.done.includes(key)
      ? state.done.filter((k) => k !== key)
      : [...state.done, key];
    persist({ ...state, done });
  };

  const doneCount = STEPS.filter((step) => state.done.includes(step.key)).length;
  const progress = Math.round((doneCount / STEPS.length) * 100);

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500 text-white flex items-center justify-center shrink-0">
            <Rocket size={20} />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">{t('setup.title')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('setup.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => persist({ ...state, dismissed: true })}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
          title={t('setup.dismiss')}
          aria-label={t('setup.dismiss')}
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs font-bold text-gray-500 dark:text-gray-400 shrink-0">
          {t('setup.progress', { done: doneCount, total: STEPS.length })}
        </span>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step) => {
          const isDone = state.done.includes(step.key);
          return (
            <li
              key={step.key}
              className={`rounded-xl border p-3 transition-colors ${
                isDone
                  ? 'border-green-200 bg-green-50/60 dark:border-green-800 dark:bg-green-900/20'
                  : 'border-gray-100 dark:border-gray-800 hover:border-primary-200 dark:hover:border-primary-800'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  onClick={() => toggleStep(step.key)}
                  className="mt-0.5 shrink-0 text-gray-300 hover:text-primary-500 dark:text-gray-600 dark:hover:text-primary-400 transition-colors"
                  title={t(`setup.steps.${step.key}.title`)}
                  aria-label={t(`setup.steps.${step.key}.title`)}
                  aria-pressed={isDone}
                >
                  {isDone
                    ? <CheckCircle2 size={18} className="text-green-500 dark:text-green-400" />
                    : <Circle size={18} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold leading-snug ${
                    isDone ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'
                  }`}>
                    {t(`setup.steps.${step.key}.title`)}
                  </p>
                  {!isDone && (
                    <Link
                      to={step.link}
                      className="mt-1 inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      {t('setup.go')}
                      <ChevronRight size={12} />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default SetupChecklist;
