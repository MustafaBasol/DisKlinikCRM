/**
 * exportStrings.ts — server-owned localized labels for the XLSX/PDF metadata
 * section (title/generated-at/applied-filters/no-data). Same pattern as
 * treatmentProposalPdf.ts's STRINGS map — the server has no i18next runtime,
 * so report-file text is localized directly here rather than through the
 * frontend's translation files.
 */

import type { SupportedExportLocale } from './types.js';

export interface ExportMetadataStrings {
  generatedAtLabel: string;
  appliedFiltersLabel: string;
  noDataLabel: string;
}

export const EXPORT_METADATA_STRINGS: Record<SupportedExportLocale, ExportMetadataStrings> = {
  en: {
    generatedAtLabel: 'Generated at',
    appliedFiltersLabel: 'Applied filters',
    noDataLabel: 'No data to export',
  },
  tr: {
    generatedAtLabel: 'Oluşturulma Tarihi',
    appliedFiltersLabel: 'Uygulanan Filtreler',
    noDataLabel: 'Dışa aktarılacak veri yok',
  },
  fr: {
    generatedAtLabel: 'Généré le',
    appliedFiltersLabel: 'Filtres appliqués',
    noDataLabel: 'Aucune donnée à exporter',
  },
  de: {
    generatedAtLabel: 'Erstellt am',
    appliedFiltersLabel: 'Angewendete Filter',
    noDataLabel: 'Keine Daten zum Exportieren',
  },
};
