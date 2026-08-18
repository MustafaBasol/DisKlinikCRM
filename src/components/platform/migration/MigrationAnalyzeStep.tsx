import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, AlertTriangle, FileSpreadsheet, ArrowRight, Rows3, Columns3, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MigrationStepProps } from './types';
import type { MigrationAnalysisDto } from '../../../services/platformMigrationApi';
import { getErrorMessage } from '../../../utils/errors';

const MigrationAnalyzeStep: React.FC<MigrationStepProps> = ({ run, api, onRunUpdated, onNext, nextStep }) => {
  const { t } = useTranslation(['platform']);
  const [analysis, setAnalysis] = useState<MigrationAnalysisDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);

  const runAnalysis = useCallback((sheetIndex?: number, mode: 'initial' | 'switch' = 'initial') => {
    mode === 'initial' ? setLoading(true) : setSwitching(true);
    setError('');
    api
      .analyze(run.id, sheetIndex)
      .then((res) => {
        setAnalysis(res.analysis);
        onRunUpdated(res.run);
      })
      .catch((err) => setError(getErrorMessage(err, t('platform:migration.analyze.errors.analyzeFailed'))))
      .finally(() => (mode === 'initial' ? setLoading(false) : setSwitching(false)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, run.id, t]);

  useEffect(() => { runAnalysis(run.sheetIndex ?? undefined, 'initial'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSheetChange = (sheetIndex: number) => {
    runAnalysis(sheetIndex, 'switch');
  };

  return (
    <div className="card p-6 max-w-3xl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t('platform:migration.analyze.title')}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">{t('platform:migration.analyze.subtitle')}</p>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
          <AlertCircle size={16} />
          <span className="text-sm">{error}</span>
        </div>
      ) : analysis ? (
        <div className="space-y-5">
          {analysis.sheets.length > 1 && (
            <div>
              <label className="label">{t('platform:migration.analyze.sheetPicker')}</label>
              <select
                className="input-field"
                value={analysis.sheetIndex}
                disabled={switching}
                onChange={(e) => handleSheetChange(Number(e.target.value))}
              >
                {analysis.sheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index} disabled={sheet.hidden}>
                    {sheet.name}{sheet.hidden ? ` (${t('platform:migration.analyze.hidden')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-primary-500" />
            <span className="font-medium text-gray-900 dark:text-white">{analysis.sheetName}</span>
            <span className="badge-blue">
              {analysis.format === 'xls' ? t('platform:migration.analyze.formatXls') : t('platform:migration.analyze.formatXlsx')}
            </span>
            {switching && <Loader2 size={14} className="animate-spin text-gray-400" />}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
              <Rows3 size={16} className="mx-auto text-gray-400 mb-1" />
              <p className="text-xl font-bold text-gray-900 dark:text-white">{analysis.totalSourceRows}</p>
              <p className="text-xs text-gray-500">{t('platform:migration.analyze.rowCount')}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
              <Columns3 size={16} className="mx-auto text-gray-400 mb-1" />
              <p className="text-xl font-bold text-gray-900 dark:text-white">{analysis.headerColumnCount}</p>
              <p className="text-xs text-gray-500">{t('platform:migration.analyze.columnCount')}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-center">
              <Layers size={16} className="mx-auto text-gray-400 mb-1" />
              <p className="text-xl font-bold text-gray-900 dark:text-white">{analysis.sheets.length}</p>
              <p className="text-xs text-gray-500">{t('platform:migration.analyze.sheetCount')}</p>
            </div>
          </div>

          {analysis.warnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {t('platform:migration.analyze.warnings')}
              </p>
              <div className="flex flex-wrap gap-2">
                {analysis.warnings.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle size={12} />
                    {t(`platform:migration.warningCodes.${code}`, { defaultValue: code })}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={switching}
            onClick={() => onNext(nextStep)}
          >
            <ArrowRight size={16} />
            {t('platform:migration.analyze.continue')}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default MigrationAnalyzeStep;
