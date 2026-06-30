CREATE TABLE "ClinicLegalProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "dataControllerTitle" TEXT,
    "taxNumber" TEXT,
    "mersisNumber" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT DEFAULT 'TR',
    "phone" TEXT,
    "email" TEXT,
    "privacyRequestEmail" TEXT,
    "kepEmail" TEXT,
    "website" TEXT,
    "dataProtectionContact" TEXT,
    "privacyNoticeText" TEXT,
    "channelDisclosureText" TEXT,
    "channelConsentText" TEXT,
    "privacyNoticeVersion" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClinicLegalProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicLegalProfile_clinicId_key" ON "ClinicLegalProfile"("clinicId");
CREATE INDEX "ClinicLegalProfile_organizationId_idx" ON "ClinicLegalProfile"("organizationId");
CREATE INDEX "ClinicLegalProfile_clinicId_idx" ON "ClinicLegalProfile"("clinicId");

ALTER TABLE "ClinicLegalProfile" ADD CONSTRAINT "ClinicLegalProfile_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
