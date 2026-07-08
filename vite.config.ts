import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Packages only ever reached via DicomViewer's dynamic import() chain.
// cornerstone-wado-image-loader is imported from its pre-built webpack dist
// bundle (see DicomViewer.tsx), which already inlines its own runtime deps
// (codecs, pako, uuid, date-format) — so those never appear as separate
// Rollup modules today. They're still listed here so that if the import
// path ever changes to the package's ESM entry (pulling these in as real
// node_modules dependencies), they land in the DICOM chunk instead of vendor.
const DICOM_ONLY_PACKAGES = [
  'cornerstone-core',
  'cornerstone-wado-image-loader',
  'dicom-parser',
  '@cornerstonejs/codec-charls',
  '@cornerstonejs/codec-libjpeg-turbo-8bit',
  '@cornerstonejs/codec-openjpeg',
  '@cornerstonejs/codec-openjph',
  'pako',
  'date-format',
  'uuid',
];

// Matches on a full node_modules path segment (not a bare substring) so a
// future package like "cornerstone-core-tools" can't be misclassified.
function isDicomRuntimeDependency(id: string): boolean {
  const normalized = id.replace(/\\/g, '/');
  return DICOM_ONLY_PACKAGES.some(pkg => normalized.includes(`/node_modules/${pkg}/`));
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (isDicomRuntimeDependency(id)) return 'dicom-viewer-libs';
          if (id.includes('recharts')) return 'charts';
          if (id.includes('@fullcalendar')) return 'calendar';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
