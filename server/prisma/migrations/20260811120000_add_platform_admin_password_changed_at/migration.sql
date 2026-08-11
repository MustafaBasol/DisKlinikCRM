-- F3-SEC-002: invalidate Platform Admin JWTs issued before the admin's last
-- recorded credential change. Additive, nullable — existing rows land NULL,
-- which authenticatePlatformAdmin() treats as "no known invalidation
-- checkpoint" (pre-migration outstanding tokens keep working until their
-- natural 8h expiry; see docs/program/evidence/
-- F3-SEC-002_PLATFORM_ADMIN_SESSION_REVOCATION.md for the migration policy).
ALTER TABLE "PlatformAdmin" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
