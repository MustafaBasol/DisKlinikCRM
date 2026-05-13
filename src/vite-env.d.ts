/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_APP_NAME: string
  readonly VITE_IDLE_TIMEOUT_MINUTES: string
  readonly VITE_EMAIL_VERIFICATION_REQUIRED: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
