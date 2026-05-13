import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './i18n/config'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex items-center justify-center h-screen font-sans text-gray-500">Aile Diş CRM başlatılıyor...</div>}>
      <App />
    </Suspense>
  </React.StrictMode>
)
