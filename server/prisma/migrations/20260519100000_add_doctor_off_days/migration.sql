-- CreateTable
CREATE TABLE "DoctorOffDay" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "practitionerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorOffDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorOffDay_clinicId_practitionerId_date_key" ON "DoctorOffDay"("clinicId", "practitionerId", "date");

-- CreateIndex
CREATE INDEX "DoctorOffDay_clinicId_practitionerId_idx" ON "DoctorOffDay"("clinicId", "practitionerId");

-- AddForeignKey
ALTER TABLE "DoctorOffDay" ADD CONSTRAINT "DoctorOffDay_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorOffDay" ADD CONSTRAINT "DoctorOffDay_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
