-- Diagnostic (run manually before applying to detect existing duplicates):
-- SELECT lower(email), COUNT(*) FROM "User" GROUP BY lower(email) HAVING COUNT(*) > 1;

-- Drop the old per-organization email uniqueness constraint
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_organizationId_email_key";

-- Enforce global case-insensitive email uniqueness at DB level
CREATE UNIQUE INDEX "User_lower_email_unique" ON "User"(lower(email));
