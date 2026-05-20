-- CreateTable
CREATE TABLE "ClinicWorkingHours" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicWorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicWorkingHours_clinicId_dayOfWeek_key" ON "ClinicWorkingHours"("clinicId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ClinicWorkingHours_clinicId_idx" ON "ClinicWorkingHours"("clinicId");

-- AddForeignKey
ALTER TABLE "ClinicWorkingHours" ADD CONSTRAINT "ClinicWorkingHours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicWorkingHours" ADD CONSTRAINT "ClinicWorkingHours_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
