import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts')) return 'charts';
          if (id.includes('@fullcalendar')) return 'calendar';
          if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n';
          // Only ever reached via DicomViewer's dynamic import() — keep isolated
          // so it's never fetched by pages that don't open a DICOM image.
          if (id.includes('cornerstone-core') || id.includes('cornerstone-wado-image-loader') || id.includes('dicom-parser')) {
            return 'dicom-viewer-libs';
          }
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
