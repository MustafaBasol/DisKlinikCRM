-- CreateTable
CREATE TABLE "PractitionerCompensationRule" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "compensationType" TEXT NOT NULL DEFAULT 'percentage',
    "fixedMonthlyAmount" DOUBLE PRECISION,
    "defaultPercentage" DOUBLE PRECISION,
    "calculationBase" TEXT NOT NULL DEFAULT 'collected',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PractitionerCompensationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCompensationRule" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION,
    "fixedAmount" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCompensationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PractitionerEarning" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "patientId" TEXT,
    "treatmentCaseId" TEXT,
    "paymentId" TEXT,
    "serviceId" TEXT,
    "grossAmount" DOUBLE PRECISION NOT NULL,
    "collectedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "earningAmount" DOUBLE PRECISION NOT NULL,
    "calculationBase" TEXT NOT NULL,
    "percentageApplied" DOUBLE PRECISION,
    "fixedAmountApplied" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "adminAdjustmentAmount" DOUBLE PRECISION,
    "adminAdjustmentReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "payoutId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PractitionerEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PractitionerPayout" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'bank_transfer',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PractitionerPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PractitionerCompensationRule_clinicId_practitionerId_isActi_idx" ON "PractitionerCompensationRule"("clinicId", "practitionerId", "isActive");

-- CreateIndex
CREATE INDEX "ServiceCompensationRule_clinicId_practitionerId_isActive_idx" ON "ServiceCompensationRule"("clinicId", "practitionerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCompensationRule_practitionerId_serviceId_key" ON "ServiceCompensationRule"("practitionerId", "serviceId");

-- CreateIndex
CREATE INDEX "PractitionerEarning_clinicId_practitionerId_periodYear_peri_idx" ON "PractitionerEarning"("clinicId", "practitionerId", "periodYear", "periodMonth");

-- CreateIndex
CREATE INDEX "PractitionerEarning_clinicId_status_idx" ON "PractitionerEarning"("clinicId", "status");

-- CreateIndex
CREATE INDEX "PractitionerPayout_clinicId_practitionerId_periodYear_perio_idx" ON "PractitionerPayout"("clinicId", "practitionerId", "periodYear", "periodMonth");

-- AddForeignKey
ALTER TABLE "PractitionerCompensationRule" ADD CONSTRAINT "PractitionerCompensationRule_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerCompensationRule" ADD CONSTRAINT "PractitionerCompensationRule_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCompensationRule" ADD CONSTRAINT "ServiceCompensationRule_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCompensationRule" ADD CONSTRAINT "ServiceCompensationRule_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCompensationRule" ADD CONSTRAINT "ServiceCompensationRule_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerEarning" ADD CONSTRAINT "PractitionerEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "PractitionerPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerPayout" ADD CONSTRAINT "PractitionerPayout_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerPayout" ADD CONSTRAINT "PractitionerPayout_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PractitionerPayout" ADD CONSTRAINT "PractitionerPayout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
