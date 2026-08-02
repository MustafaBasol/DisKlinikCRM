-- US-05.2: purchase-unit <-> consumption-unit conversion (koli <-> adet).
--
-- Purely additive migration:
--  * new table "InventoryUnit" (clinic-scoped unit reference data)
--  * new nullable columns on "InventoryItem" (purchaseUnitId, consumptionUnitId, conversionFactor)
--  * new nullable columns on "InventoryTransaction" (unitId, quantityInBaseUnit)
--
-- No existing row in InventoryItem/InventoryTransaction is modified. All new
-- columns are nullable and default to NULL, so old application code (which
-- does not know about them) keeps reading/writing exactly as before. New
-- code treats NULL conversionFactor / NULL quantityInBaseUnit as "legacy
-- item/transaction, not yet migrated to the unit-conversion model" and never
-- guesses or backfills a value on their behalf (see server/src/routes/
-- inventoryUnits.ts and inventory.ts for the read-side interpretation).

CREATE TABLE "InventoryUnit" (
    "id"           TEXT NOT NULL,
    "clinicId"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryUnit_clinicId_name_key" ON "InventoryUnit"("clinicId", "name");
CREATE UNIQUE INDEX "InventoryUnit_clinicId_abbreviation_key" ON "InventoryUnit"("clinicId", "abbreviation");
CREATE INDEX "InventoryUnit_clinicId_isActive_idx" ON "InventoryUnit"("clinicId", "isActive");

ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryItem"
ADD COLUMN "purchaseUnitId"    TEXT,
ADD COLUMN "consumptionUnitId" TEXT,
ADD COLUMN "conversionFactor"  DOUBLE PRECISION;

CREATE INDEX "InventoryItem_clinicId_purchaseUnitId_idx" ON "InventoryItem"("clinicId", "purchaseUnitId");
CREATE INDEX "InventoryItem_clinicId_consumptionUnitId_idx" ON "InventoryItem"("clinicId", "consumptionUnitId");

-- ON DELETE RESTRICT: an InventoryUnit referenced by an item can only be
-- deactivated (isActive = false), never hard-deleted, so this FK never blocks
-- application-level writes under the intended workflow.
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_purchaseUnitId_fkey" FOREIGN KEY ("purchaseUnitId") REFERENCES "InventoryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_consumptionUnitId_fkey" FOREIGN KEY ("consumptionUnitId") REFERENCES "InventoryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryTransaction"
ADD COLUMN "unitId"             TEXT,
ADD COLUMN "quantityInBaseUnit" DOUBLE PRECISION;

CREATE INDEX "InventoryTransaction_clinicId_unitId_idx" ON "InventoryTransaction"("clinicId", "unitId");

ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
