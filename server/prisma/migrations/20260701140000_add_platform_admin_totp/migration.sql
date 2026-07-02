-- Platform admin MFA (TOTP)
ALTER TABLE "PlatformAdmin" ADD COLUMN "totpSecretEncrypted" TEXT;
ALTER TABLE "PlatformAdmin" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
