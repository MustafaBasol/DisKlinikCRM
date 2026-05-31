import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import i18n from './i18n/config'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex items-center justify-center h-screen font-sans text-gray-500">{i18n.t('common:startingApp')}</div>}>
      <App />
    </Suspense>
  </React.StrictMode>
)
