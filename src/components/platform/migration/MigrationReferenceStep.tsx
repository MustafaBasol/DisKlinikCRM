import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, ShieldAlert, CheckCircle2, XCircle, HelpCircle, ArrowRight, EyeOff, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type { ReferenceCandidateDto, ReferenceValueDto, ReferenceWriteEntry, ReferenceMapStatus } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';

const DATALIST_ID = 'migration-reference-candidates';

/**
 * A UTF-8 byte-order mark, and CRLF line endings, for the unresolved-list CSV.
 *
 * Neither is decoration. Excel on a Turkish Windows install opens a BOM-less
 * UTF-8 CSV in the system codepage, turning every ç/ğ/ı/ö/ş/ü into mojibake —
 * in a file whose whole purpose is to be read by a Turkish-speaking operator.
 * CRLF is what RFC 4180 specifies and what Excel writes back.
 */
const BOM = '\uFEFF';
const CRLF = '\r\n';

function candidateText(c: ReferenceCandidateDto): string {
  return `${c.name} (${c.role})`;
}

interface RowProps {
  value: ReferenceValueDto;
  candidates: ReferenceCandidateDto[];
  saving: boolean;
  onResolve: (sourceValue: string, candidate: ReferenceCandidateDto) => void;
  onClear: (sourceValue: string) => void;
  onIgnore: (sourceValue: string) => void;
}

const ReferenceRow: React.FC<RowProps> = React.memo(({ value, candidates, saving, onResolve, onClear, onIgnore }) => {
  const { t } = useTranslation(['platform']);
  const [text, setText] = useState(value.destinationLabel ?? '');

  useEffect(() => { setText(value.destinationLabel ?? ''); }, [value.destinationLabel]);

  const byText = useMemo(() => new Map(candidates.map((c) => [candidateText(c), c])), [candidates]);

  const statusMeta: Record<ReferenceMapStatus, { icon: React.ReactNode; className: string; labelKey: string }> = {
    UNMAPPED: { icon: <HelpCircle size={13} />, className: 'text-gray-500', labelKey: 'platform:migration.reference.status.unmapped' },
    MAPPED_APPROVED: { icon: <CheckCircle2 size={13} />, className: 'text-green-600 dark:text-green-400', labelKey: 'platform:migration.reference.status.mappedApproved' },
    MAPPED_IGNORED: { icon: <EyeOff size={13} />, className: 'text-gray-400', labelKey: 'platform:migration.reference.status.mappedIgnored' },
    CONFLICTED: { icon: <XCircle size={13} />, className: 'text-red-600 dark:text-red-400', labelKey: 'platform:migration.reference.status.conflicted' },
  };
  const meta = statusMeta[value.status];

  return (
    <tr className="border-b border-gray-50 dark:border-gray-800">
      <td className="px-3 py-2.5">
        <p className="font-mono text-xs font-semibold text-gray-900 dark:text-white break-all">{value.sourceValue}</p>
      </td>
      <td className="px-3 py-2.5 text-center text-sm text-gray-700 dark:text-gray-300">{value.rowCount}</td>
      <td className="px-3 py-2.5 min-w-[220px]">
        <input
          type="text"
          list={DATALIST_ID}
          value={text}
          disabled={saving || value.status === 'MAPPED_IGNORED'}
          placeholder={t('platform:migration.reference.searchPlaceholder')}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const candidate = byText.get(next);
            if (candidate) onResolve(value.sourceValue, candidate);
          }}
          onBlur={() => {
            if (!text) onClear(value.sourceValue);
          }}
          className="input-field text-xs py-1.5"
        />
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.className}`}>
          {meta.icon}
          {t(meta.labelKey)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          {value.status !== 'MAPPED_IGNORED' ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => onIgnore(value.sourceValue)}
              className="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
            >
              {t('platform:migration.reference.actions.ignore')}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => onClear(value.sourceValue)}
              className="text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-40"
            >
              {t('platform:migration.reference.actions.unignore')}
            </button>
          )}
          {saving && <Loader2 size={13} className="animate-spin text-gray-400 self-center" />}
        </div>
      </td>
    </tr>
  );
});
ReferenceRow.displayName = 'ReferenceRow';

const MigrationReferenceStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep }) => {
  const { t } = useTranslation(['platform']);
  const [required, setRequired] = useState(false);
  const [values, setValues] = useState<ReferenceValueDto[] | null>(null);
  const [candidates, setCandidates] = useState<ReferenceCandidateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingValue, setSavingValue] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);

  const fetchReferences = useCallback(() => {
    setLoading(true);
    setError('');
    api.getReferences(run.id)
      .then((res) => {
        setRequired(res.required);
        setValues(res.values);
        setCandidates(res.candidates);
      })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.reference.errors.loadFailed'))))
      .finally(() => setLoading(false));
  }, [api, run.id, t]);

  useEffect(() => { fetchReferences(); }, [fetchReferences]);

  /**
   * Save ONE reference decision. F3-DATA-MIG-TODAY-001-R12.
   *
   * This used to re-send the whole `values` array on every change, exactly like
   * the mapping screen did — so resolving one of 25 practitioner ids issued 25
   * upserts, each one re-stamping `approvedByPlatformAdminId` and `approvedAt`
   * on decisions the operator had taken minutes earlier. The audit trail then
   * said 25 approvals happened at the same instant, which is not what happened,
   * and two quick edits could reorder into the second overwriting the first
   * with the stale copy it was holding.
   *
   * Sending only the changed entry makes the stored approval evidence describe
   * the decision that was actually taken. The server upserts per entry, so a
   * one-element array is a first-class request, not a special case.
   */
  const persist = useCallback((sourceValue: string, next: ReferenceValueDto[]) => {
    setSavingValue(sourceValue);
    setSaveError('');
    const edited = next.find((v) => v.sourceValue === sourceValue);
    if (!edited) {
      setSavingValue(null);
      return;
    }
    const entries: ReferenceWriteEntry[] = [{
      entityType: 'practitioner',
      sourceValue: edited.sourceValue,
      destinationId: edited.destinationId,
      status: edited.status,
    }];
    api.saveReferences(run.id, entries)
      .then((saved) => setValues(saved))
      .catch((err) => setSaveError(getErrorMessage(err, t('platform:migration.reference.errors.saveFailed'))))
      .finally(() => setSavingValue(null));
  }, [api, run.id, t]);

  const handleResolve = useCallback((sourceValue: string, candidate: ReferenceCandidateDto) => {
    setValues((prev) => {
      if (!prev) return prev;
      const next = prev.map((v) => v.sourceValue === sourceValue
        ? { ...v, destinationId: candidate.id, destinationLabel: candidateText(candidate), status: 'MAPPED_APPROVED' as const }
        : v);
      persist(sourceValue, next);
      return next;
    });
  }, [persist]);

  const handleClear = useCallback((sourceValue: string) => {
    setValues((prev) => {
      if (!prev) return prev;
      const next = prev.map((v) => v.sourceValue === sourceValue
        ? { ...v, destinationId: null, destinationLabel: null, status: 'UNMAPPED' as const }
        : v);
      persist(sourceValue, next);
      return next;
    });
  }, [persist]);

  const handleIgnore = useCallback((sourceValue: string) => {
    setValues((prev) => {
      if (!prev) return prev;
      const next = prev.map((v) => v.sourceValue === sourceValue
        ? { ...v, destinationId: null, destinationLabel: null, status: 'MAPPED_IGNORED' as const }
        : v);
      persist(sourceValue, next);
      return next;
    });
  }, [persist]);

  const unresolvedValues = useMemo(
    () => (values ?? []).filter((v) => v.status === 'UNMAPPED' || v.status === 'CONFLICTED'),
    [values],
  );
  const unresolvedCount = unresolvedValues.length;
  const visibleValues = unresolvedOnly ? unresolvedValues : (values ?? []);

  /**
   * Download the still-unresolved vendor practitioner ids, with how many rows
   * each one affects (F3-DATA-MIG-TODAY-001-R12).
   *
   * Built ENTIRELY from data already on this screen — there is no new endpoint
   * and no second server path to these values, so there is nothing new to
   * authorize or audit. The clinic uses it to look the codes up in their own
   * legacy system and come back with the answer, which is the only place that
   * answer exists.
   *
   * A UTF-8 BOM, because this file is opened in Excel on a Turkish Windows
   * install and without it every ç/ğ/ı/ö/ş/ü in a practitioner label is
   * mojibake.
   */
  const handleDownloadUnresolved = useCallback(() => {
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      [
        t('platform:migration.reference.columns.sourceLabel'),
        t('platform:migration.reference.columns.rowCount'),
        t('platform:migration.reference.columns.status'),
      ].map(cell).join(','),
      ...unresolvedValues.map((v) => [v.sourceValue, v.rowCount, v.status].map(cell).join(',')),
    ];
    const blob = new Blob([BOM + lines.join(CRLF) + CRLF], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `migration-${run.id}-unresolved-references.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [unresolvedValues, run.id, t]);

  const handleContinue = async () => {
    setAdvancing(true);
    setSaveError('');
    try {
      const detail = await api.getRun(run.id);
      onRunUpdated(detail.run);
      onNext(nextStep);
    } catch (err) {
      setSaveError(getErrorMessage(err, t('platform:migration.reference.errors.loadFailed')));
    } finally {
      setAdvancing(false);
    }
  };

  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('platform:migration.reference.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('platform:migration.reference.subtitle')}</p>

      <div className="flex items-start gap-2 mb-4 text-xs text-primary-800 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3">
        <ShieldAlert size={14} className="shrink-0 mt-0.5" />
        <span className="font-medium">{t('platform:migration.reference.noNewUsersNote')}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      ) : !required || !values || values.length === 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-sm">
            <CheckCircle2 size={16} />
            {t('platform:migration.reference.notRequired')}
          </div>
          <button type="button" className="btn-primary w-full justify-center" disabled={advancing} onClick={handleContinue}>
            {advancing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {t('platform:migration.reference.continue')}
          </button>
        </div>
      ) : (
        <>
          <datalist id={DATALIST_ID}>
            {candidates.map((c) => <option key={c.id} value={candidateText(c)} />)}
          </datalist>

          <div className={`flex items-center gap-2 mb-3 text-sm rounded-lg p-3 ${unresolvedCount > 0 ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'}`}>
            {unresolvedCount > 0 ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {t('platform:migration.reference.unresolvedCount', { n: unresolvedCount })}
          </div>

          {/*
            * TRIAGE CONTROLS (F3-DATA-MIG-TODAY-001-R12). Twenty-five vendor
            * ids is a short list, but only the unresolved ones are work — and
            * the operator usually has to leave this screen, ask the clinic who
            * these codes are, and come back. Both of those needs are one click
            * each now instead of scrolling and re-reading.
            */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={unresolvedOnly}
                onChange={(e) => setUnresolvedOnly(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              {t('platform:migration.reference.showUnresolvedOnly')}
            </label>
            {unresolvedCount > 0 && (
              <button type="button" className="btn-secondary text-xs" onClick={handleDownloadUnresolved}>
                <Download size={13} />
                {t('platform:migration.reference.downloadUnresolved')}
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">
              {t('platform:migration.reference.rowsShown', { shown: visibleValues.length, total: values.length })}
            </span>
          </div>

          {saveError && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5 mb-3 text-sm">
              <AlertCircle size={14} />
              {saveError}
            </div>
          )}

          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg mb-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">{t('platform:migration.reference.columns.sourceLabel')}</th>
                  <th className="px-3 py-2 text-center">{t('platform:migration.reference.columns.rowCount')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.reference.columns.destination')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.reference.columns.status')}</th>
                  <th className="px-3 py-2 text-left">{t('platform:migration.reference.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleValues.map((v) => (
                  <ReferenceRow
                    key={v.sourceValue}
                    value={v}
                    candidates={candidates}
                    saving={savingValue === v.sourceValue}
                    onResolve={handleResolve}
                    onClear={handleClear}
                    onIgnore={handleIgnore}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={unresolvedCount > 0 || advancing}
            onClick={handleContinue}
          >
            {advancing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {unresolvedCount > 0 ? t('platform:migration.reference.resolveAllFirst') : t('platform:migration.reference.continue')}
          </button>
        </>
      )}
    </div>
  );
};

export default MigrationReferenceStep;
