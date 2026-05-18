-- AlterTable: add treatmentCaseId to Appointment
ALTER TABLE "Appointment" ADD COLUMN "treatmentCaseId" TEXT;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
