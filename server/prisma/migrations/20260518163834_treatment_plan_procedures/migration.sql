-- CreateTable
CREATE TABLE "TreatmentPlanProcedure" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "treatmentCaseId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "toothFdi" INTEGER,
    "procedureName" TEXT NOT NULL,
    "serviceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPlanProcedure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreatmentPlanProcedure_clinicId_treatmentCaseId_idx" ON "TreatmentPlanProcedure"("clinicId", "treatmentCaseId");

-- CreateIndex
CREATE INDEX "TreatmentPlanProcedure_clinicId_patientId_toothFdi_idx" ON "TreatmentPlanProcedure"("clinicId", "patientId", "toothFdi");

-- AddForeignKey
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
