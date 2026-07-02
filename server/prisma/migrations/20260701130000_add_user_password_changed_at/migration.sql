-- Invalidate JWTs issued before the user's last password change
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
