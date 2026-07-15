-- CreateTable
CREATE TABLE "PublicBookingNoticeEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "legalProfileId" TEXT,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "appointmentRequestId" TEXT,
    "noticeVersion" TEXT NOT NULL,
    "noticeEffectiveDate" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'tr',
    "channel" TEXT NOT NULL DEFAULT 'web_booking',
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noticeTextSnapshot" TEXT NOT NULL,
    "controllerNameSnapshot" TEXT NOT NULL,
    "privacyContactSnapshot" TEXT,
    "noticeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicBookingNoticeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicBookingNoticeEvidence_tokenHash_key" ON "PublicBookingNoticeEvidence"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PublicBookingNoticeEvidence_appointmentRequestId_key" ON "PublicBookingNoticeEvidence"("appointmentRequestId");

-- CreateIndex
CREATE INDEX "PublicBookingNoticeEvidence_clinicId_sessionId_channel_idx" ON "PublicBookingNoticeEvidence"("clinicId", "sessionId", "channel");

-- CreateIndex
CREATE INDEX "PublicBookingNoticeEvidence_organizationId_idx" ON "PublicBookingNoticeEvidence"("organizationId");

-- CreateIndex
CREATE INDEX "PublicBookingNoticeEvidence_tokenHash_idx" ON "PublicBookingNoticeEvidence"("tokenHash");

-- CreateIndex
CREATE INDEX "PublicBookingNoticeEvidence_expiresAt_idx" ON "PublicBookingNoticeEvidence"("expiresAt");

-- AddForeignKey
ALTER TABLE "PublicBookingNoticeEvidence" ADD CONSTRAINT "PublicBookingNoticeEvidence_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicBookingNoticeEvidence" ADD CONSTRAINT "PublicBookingNoticeEvidence_legalProfileId_fkey" FOREIGN KEY ("legalProfileId") REFERENCES "ClinicLegalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicBookingNoticeEvidence" ADD CONSTRAINT "PublicBookingNoticeEvidence_appointmentRequestId_fkey" FOREIGN KEY ("appointmentRequestId") REFERENCES "AppointmentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
