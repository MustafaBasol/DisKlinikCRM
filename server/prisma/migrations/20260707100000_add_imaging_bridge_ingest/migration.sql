-- Migration: add_imaging_bridge_ingest
-- Supports bridge-agent image ingest (PR A): ImagingStudy.createdById becomes
-- nullable (bridge uploads have no user actor), bridgeAgentId records
-- provenance, and ingestKey + a clinic-scoped unique index give idempotent
-- retries. Deduping is scoped to (clinicId, ingestKey) — not bridgeAgentId —
-- so replacing or adding bridge agents in the same clinic cannot cause the
-- same file to be ingested twice.

-- AlterTable: createdById nullable
ALTER TABLE "ImagingStudy" ALTER COLUMN "createdById" DROP NOT NULL;

-- AlterTable: bridge provenance + idempotency key
ALTER TABLE "ImagingStudy" ADD COLUMN "bridgeAgentId" TEXT;
ALTER TABLE "ImagingStudy" ADD COLUMN "ingestKey" TEXT;

-- AddForeignKey
ALTER TABLE "ImagingStudy" ADD CONSTRAINT "ImagingStudy_bridgeAgentId_fkey" FOREIGN KEY ("bridgeAgentId") REFERENCES "ImagingBridgeAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex (Postgres treats NULLs as distinct, so manual uploads with ingestKey = NULL never collide)
CREATE UNIQUE INDEX "ImagingStudy_clinicId_ingestKey_key" ON "ImagingStudy"("clinicId", "ingestKey");
