/**
 * legacyWhatsApp.ts — Legacy Evolution API env-var configuration helper
 *
 * Controls whether the backend will fall back to env-var WhatsApp credentials
 * when no DB-backed WhatsAppConnection exists for a clinic.
 *
 * ─── Production migration guide ──────────────────────────────────────────────
 *
 * Step 1: Import the legacy connection into the panel.
 *   → Navigate to /organization/whatsapp and click "Panel Yönetimine Aktar".
 *   → The env-var config is copied to the DB as a WhatsAppConnection record.
 *   → All clinics in the organization are automatically assigned.
 *
 * Step 2: Verify the imported DB connection works.
 *   → Click "Test Et" on the newly imported connection card.
 *   → Send a test message from the Appointments or Messaging module.
 *   → Confirm that WhatsApp messages are received.
 *
 * Step 3: Disable the legacy fallback.
 *   → Set ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false in your .env (or Hostinger env).
 *   → Restart the backend.
 *   → Verify messaging still works (now DB-backed only).
 *
 * Step 4: Remove the legacy env variables (optional, clean-up).
 *   → Remove EVOLUTION_API_BASE_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME.
 *   → Restart the backend.
 *   → The legacy card on /organization/whatsapp will no longer appear.
 *
 * ─── Security notes ──────────────────────────────────────────────────────────
 *
 * • EVOLUTION_API_KEY is NEVER logged or returned to clients from this utility.
 * • When fallback is disabled, the raw key is not read at all.
 * • After importing, the key is stored AES-256-GCM encrypted in the DB.
 *
 * ─── Flag semantics ──────────────────────────────────────────────────────────
 *
 * ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=true   → use env fallback if no DB record (default)
 * ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false  → panel-first; error if no DB record
 * ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=       → treated as enabled (safe default)
 */

export interface LegacyEvolutionConfig {
  url: string;
  key: string;
  instanceName: string;
}

/**
 * Returns true when the legacy env-var fallback is active.
 * Default is true (backwards-compatible). Set to "false" or "0" in production
 * once all connections have been imported via the panel.
 */
export function isLegacyFallbackEnabled(): boolean {
  const flag = process.env.ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK?.trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  return true; // safe default
}

/**
 * Returns the legacy Evolution API config from env vars, or null if:
 * - the fallback is disabled via ENABLE_LEGACY_WHATSAPP_ENV_FALLBACK=false, OR
 * - any required env var is missing.
 *
 * NEVER exposes the key in logs — callers must not log the returned object.
 */
export function getLegacyEvolutionConfig(): LegacyEvolutionConfig | null {
  if (!isLegacyFallbackEnabled()) return null;

  const url = process.env.EVOLUTION_API_BASE_URL?.trim();
  const key = process.env.EVOLUTION_API_KEY?.trim();
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim();

  if (!url || !key || !instanceName) return null;
  return { url, key, instanceName };
}

/**
 * Returns true when all three legacy env vars are present (regardless of the
 * flag). Used by the UI virtual-entry check to decide whether to surface the
 * amber "import me" card on /organization/whatsapp.
 */
export function hasLegacyEnvVars(): boolean {
  return Boolean(
    process.env.EVOLUTION_API_BASE_URL?.trim() &&
      process.env.EVOLUTION_API_KEY?.trim() &&
      process.env.EVOLUTION_INSTANCE_NAME?.trim(),
  );
}
