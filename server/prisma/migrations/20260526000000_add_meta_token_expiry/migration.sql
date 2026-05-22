-- Migration: add_meta_token_expiry
-- Adds token lifecycle tracking fields to WhatsAppConnection.
-- Meta access tokens expire approximately every 60 days unless refreshed.
-- These fields allow the UI to warn operators before a token expires.

ALTER TABLE "WhatsAppConnection"
  ADD COLUMN IF NOT EXISTS "metaTokenStatus"        TEXT        DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "metaTokenExpiresAt"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "metaTokenLastCheckedAt" TIMESTAMPTZ;
