-- CreateTable
CREATE TABLE "AppointmentRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "appointmentTypeId" TEXT,
    "practitionerId" TEXT,
    "preferredStartTime" DATETIME,
    "preferredEndTime" DATETIME,
    "requestType" TEXT NOT NULL DEFAULT 'appointment',
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rawMessage" TEXT,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "convertedAppointmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppointmentRequest_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AppointmentRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AppointmentRequest_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "AppointmentType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AppointmentRequest_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AppointmentRequest_convertedAppointmentId_fkey" FOREIGN KEY ("convertedAppointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AppointmentRequest_clinicId_status_createdAt_idx" ON "AppointmentRequest"("clinicId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AppointmentRequest_clinicId_phone_idx" ON "AppointmentRequest"("clinicId", "phone");

-- CreateIndex
CREATE INDEX "AppointmentRequest_clinicId_practitionerId_idx" ON "AppointmentRequest"("clinicId", "practitionerId");
