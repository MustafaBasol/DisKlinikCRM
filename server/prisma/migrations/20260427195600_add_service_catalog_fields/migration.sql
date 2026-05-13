ALTER TABLE "AppointmentType" ADD COLUMN "category" TEXT;
ALTER TABLE "AppointmentType" ADD COLUMN "description" TEXT;
ALTER TABLE "AppointmentType" ADD COLUMN "basePrice" REAL;
ALTER TABLE "AppointmentType" ADD COLUMN "currency" TEXT;
ALTER TABLE "AppointmentType" ADD COLUMN "isService" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TreatmentCase" ADD COLUMN "appointmentTypeId" TEXT;
ALTER TABLE "TreatmentCase" ADD COLUMN "createdById" TEXT;

PRAGMA foreign_keys=off;

CREATE TABLE "new_TreatmentCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "practitionerId" TEXT,
    "appointmentTypeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "estimatedAmount" REAL,
    "acceptedAmount" REAL,
    "currency" TEXT,
    "expectedStartDate" DATETIME,
    "closedAt" DATETIME,
    "lostReason" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "TreatmentCase_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TreatmentCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TreatmentCase_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TreatmentCase_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "AppointmentType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_TreatmentCase" (
    "id",
    "clinicId",
    "patientId",
    "practitionerId",
    "appointmentTypeId",
    "title",
    "description",
    "stage",
    "estimatedAmount",
    "acceptedAmount",
    "currency",
    "expectedStartDate",
    "closedAt",
    "lostReason",
    "createdById",
    "createdAt",
    "updatedAt",
    "deletedAt"
)
SELECT
    "id",
    "clinicId",
    "patientId",
    "practitionerId",
    "appointmentTypeId",
    "title",
    "description",
    "stage",
    "estimatedAmount",
    "acceptedAmount",
    "currency",
    "expectedStartDate",
    "closedAt",
    "lostReason",
    "createdById",
    "createdAt",
    "updatedAt",
    "deletedAt"
FROM "TreatmentCase";

DROP TABLE "TreatmentCase";
ALTER TABLE "new_TreatmentCase" RENAME TO "TreatmentCase";

PRAGMA foreign_key_check;
PRAGMA foreign_keys=on;
