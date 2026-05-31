import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, Calendar, Stethoscope, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { patientService, appointmentService, treatmentCaseService } from '../services/api';

interface SearchResult {
  id: string;
  type: 'patient' | 'appointment' | 'treatment';
  title: string;
  subtitle: string;
  path: string;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('common');

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const [patientsRes, appointmentsRes, casesRes] = await Promise.allSettled([
        patientService.getAll({ search: q, limit: 5 }),
        appointmentService.getAll({ search: q, limit: 5 }),
        treatmentCaseService.getAll({ search: q, limit: 5 }),
      ]);

      const combined: SearchResult[] = [];

      if (patientsRes.status === 'fulfilled') {
        const patients = Array.isArray(patientsRes.value.data)
          ? patientsRes.value.data
          : patientsRes.value.data?.data ?? [];
        patients.slice(0, 5).forEach((p: any) => {
          combined.push({
            id: p.id,
            type: 'patient',
            title: `${p.firstName} ${p.lastName}`,
            subtitle: p.phone || p.email || '',
            path: `/patients/${p.id}`,
          });
        });
      }

      if (appointmentsRes.status === 'fulfilled') {
        const appointments = Array.isArray(appointmentsRes.value.data)
          ? appointmentsRes.value.data
          : appointmentsRes.value.data?.data ?? [];
        appointments.slice(0, 5).forEach((a: any) => {
          combined.push({
            id: a.id,
            type: 'appointment',
            title: `${a.patient?.firstName ?? ''} ${a.patient?.lastName ?? ''}`.trim(),
            subtitle: `${a.appointmentType?.name ?? ''} — ${new Date(a.startTime).toLocaleDateString(i18n.language)}`,
            path: `/appointments/${a.id}`,
          });
        });
      }

      if (casesRes.status === 'fulfilled') {
        const cases = Array.isArray(casesRes.value.data)
          ? casesRes.value.data
          : casesRes.value.data?.data ?? [];
        cases.slice(0, 5).forEach((c: any) => {
          combined.push({
            id: c.id,
            type: 'treatment',
            title: c.title || `${c.patient?.firstName ?? ''} ${c.patient?.lastName ?? ''}`.trim(),
            subtitle: c.stage || '',
            path: `/treatment-cases/${c.id}`,
          });
        });
      }

      setResults(combined);
      setActiveIndex(0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  const handleSelect = (result: SearchResult) => {
    navigate(result.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const TypeIcon = ({ type }: { type: SearchResult['type'] }) => {
    if (type === 'patient') return <User size={16} className="text-blue-500" />;
    if (type === 'appointment') return <Calendar size={16} className="text-emerald-500" />;
    return <Stethoscope size={16} className="text-violet-500" />;
  };

  const typeLabel = (type: SearchResult['type']) => {
    if (type === 'patient') return t('globalSearch.types.patient');
    if (type === 'appointment') return t('globalSearch.types.appointment');
    return t('globalSearch.types.treatment');
  };

  if (!isOpen) return null;

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
          />
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-2">
            {results.map((result, i) => (
              <li key={`${result.type}-${result.id}`}>
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === activeIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <TypeIcon type={result.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{result.title}</p>
                    <p className="text-xs text-gray-500 truncate">{result.subtitle}</p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 shrink-0">
                    {typeLabel(result.type)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {query.length >= 2 && !loading && results.length === 0 && (
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
