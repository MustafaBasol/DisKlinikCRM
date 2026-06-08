-- Treatment packages, service material recipes, and stock deduction tracking.

ALTER TABLE "TreatmentPlanProcedure"
ADD COLUMN "packageApplicationId" TEXT,
ADD COLUMN "treatmentPackageId" TEXT,
ADD COLUMN "packageItemId" TEXT,
ADD COLUMN "stockDeductedAt" TIMESTAMP(3),
ADD COLUMN "stockDeductionStatus" TEXT,
ADD COLUMN "stockDeductionError" TEXT;

ALTER TABLE "InventoryTransaction"
ADD COLUMN "treatmentPlanProcedureId" TEXT,
ADD COLUMN "serviceId" TEXT,
ADD COLUMN "treatmentPackageId" TEXT,
ADD COLUMN "packageApplicationId" TEXT;

CREATE TABLE "TreatmentPackage" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "color" TEXT,
    "durationMinutes" INTEGER,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "pricingMode" TEXT NOT NULL DEFAULT 'PACKAGE_PRICE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreatmentPackageItem" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "overridePrice" DOUBLE PRECISION,
    "overrideDurationMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPackageItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentTypeMaterial" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "deductionTiming" TEXT NOT NULL DEFAULT 'ON_TREATMENT_COMPLETED',
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentTypeMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreatmentPackageMaterial" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "deductionTiming" TEXT NOT NULL DEFAULT 'ON_TREATMENT_COMPLETED',
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPackageMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreatmentPackageApplication" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "treatmentCaseId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "pricingMode" TEXT NOT NULL,
    "totalDurationMinutes" INTEGER,
    "totalPrice" DOUBLE PRECISION,
    "currency" TEXT,
    "createdById" TEXT NOT NULL,
    "extraMaterialsDeductedAt" TIMESTAMP(3),
    "extraMaterialsDeductionStatus" TEXT,
    "extraMaterialsDeductionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreatmentPackageApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreatmentPackage_clinicId_name_key" ON "TreatmentPackage"("clinicId", "name");
CREATE INDEX "TreatmentPackage_clinicId_isActive_idx" ON "TreatmentPackage"("clinicId", "isActive");

CREATE UNIQUE INDEX "TreatmentPackageItem_packageId_serviceId_key" ON "TreatmentPackageItem"("packageId", "serviceId");
CREATE INDEX "TreatmentPackageItem_clinicId_idx" ON "TreatmentPackageItem"("clinicId");
CREATE INDEX "TreatmentPackageItem_packageId_idx" ON "TreatmentPackageItem"("packageId");
CREATE INDEX "TreatmentPackageItem_serviceId_idx" ON "TreatmentPackageItem"("serviceId");

CREATE UNIQUE INDEX "AppointmentTypeMaterial_serviceId_inventoryItemId_key" ON "AppointmentTypeMaterial"("serviceId", "inventoryItemId");
CREATE INDEX "AppointmentTypeMaterial_clinicId_idx" ON "AppointmentTypeMaterial"("clinicId");
CREATE INDEX "AppointmentTypeMaterial_serviceId_idx" ON "AppointmentTypeMaterial"("serviceId");
CREATE INDEX "AppointmentTypeMaterial_inventoryItemId_idx" ON "AppointmentTypeMaterial"("inventoryItemId");

CREATE UNIQUE INDEX "TreatmentPackageMaterial_packageId_inventoryItemId_key" ON "TreatmentPackageMaterial"("packageId", "inventoryItemId");
CREATE INDEX "TreatmentPackageMaterial_clinicId_idx" ON "TreatmentPackageMaterial"("clinicId");
CREATE INDEX "TreatmentPackageMaterial_packageId_idx" ON "TreatmentPackageMaterial"("packageId");
CREATE INDEX "TreatmentPackageMaterial_inventoryItemId_idx" ON "TreatmentPackageMaterial"("inventoryItemId");

CREATE INDEX "TreatmentPackageApplication_clinicId_treatmentCaseId_idx" ON "TreatmentPackageApplication"("clinicId", "treatmentCaseId");
CREATE INDEX "TreatmentPackageApplication_clinicId_packageId_idx" ON "TreatmentPackageApplication"("clinicId", "packageId");
CREATE INDEX "TreatmentPackageApplication_clinicId_patientId_idx" ON "TreatmentPackageApplication"("clinicId", "patientId");

CREATE INDEX "InventoryTransaction_clinicId_treatmentPlanProcedureId_idx" ON "InventoryTransaction"("clinicId", "treatmentPlanProcedureId");
CREATE INDEX "InventoryTransaction_clinicId_packageApplicationId_idx" ON "InventoryTransaction"("clinicId", "packageApplicationId");

CREATE INDEX "TreatmentPlanProcedure_clinicId_packageApplicationId_idx" ON "TreatmentPlanProcedure"("clinicId", "packageApplicationId");
CREATE INDEX "TreatmentPlanProcedure_clinicId_treatmentPackageId_idx" ON "TreatmentPlanProcedure"("clinicId", "treatmentPackageId");

ALTER TABLE "TreatmentPackage" ADD CONSTRAINT "TreatmentPackage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreatmentPackageItem" ADD CONSTRAINT "TreatmentPackageItem_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageItem" ADD CONSTRAINT "TreatmentPackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TreatmentPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageItem" ADD CONSTRAINT "TreatmentPackageItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentTypeMaterial" ADD CONSTRAINT "AppointmentTypeMaterial_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppointmentTypeMaterial" ADD CONSTRAINT "AppointmentTypeMaterial_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentTypeMaterial" ADD CONSTRAINT "AppointmentTypeMaterial_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreatmentPackageMaterial" ADD CONSTRAINT "TreatmentPackageMaterial_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageMaterial" ADD CONSTRAINT "TreatmentPackageMaterial_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TreatmentPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageMaterial" ADD CONSTRAINT "TreatmentPackageMaterial_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreatmentPackageApplication" ADD CONSTRAINT "TreatmentPackageApplication_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageApplication" ADD CONSTRAINT "TreatmentPackageApplication_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageApplication" ADD CONSTRAINT "TreatmentPackageApplication_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageApplication" ADD CONSTRAINT "TreatmentPackageApplication_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TreatmentPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TreatmentPackageApplication" ADD CONSTRAINT "TreatmentPackageApplication_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_packageApplicationId_fkey" FOREIGN KEY ("packageApplicationId") REFERENCES "TreatmentPackageApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_treatmentPackageId_fkey" FOREIGN KEY ("treatmentPackageId") REFERENCES "TreatmentPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TreatmentPlanProcedure" ADD CONSTRAINT "TreatmentPlanProcedure_packageItemId_fkey" FOREIGN KEY ("packageItemId") REFERENCES "TreatmentPackageItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_treatmentPlanProcedureId_fkey" FOREIGN KEY ("treatmentPlanProcedureId") REFERENCES "TreatmentPlanProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "AppointmentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_treatmentPackageId_fkey" FOREIGN KEY ("treatmentPackageId") REFERENCES "TreatmentPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_packageApplicationId_fkey" FOREIGN KEY ("packageApplicationId") REFERENCES "TreatmentPackageApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
