-- AlterTable
ALTER TABLE "ImagingBridgeAgent" ADD COLUMN     "installationId" TEXT,
ADD COLUMN     "machineIdHash" TEXT,
ADD COLUMN     "computerDisplayName" TEXT,
ADD COLUMN     "osVersion" TEXT,
ADD COLUMN     "architecture" TEXT,
ADD COLUMN     "capabilities" JSONB,
ADD COLUMN     "pendingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSuccessfulUploadAt" TIMESTAMP(3),
ADD COLUMN     "lastErrorCategory" TEXT,
ADD COLUMN     "updateChannel" TEXT NOT NULL DEFAULT 'stable',
ADD COLUMN     "lastUpdateCheckAt" TIMESTAMP(3),
ADD COLUMN     "createdWithPairingId" TEXT;

-- CreateTable
CREATE TABLE "ImagingBridgePairing" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "bridgeName" TEXT NOT NULL,
    "bridgeAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingBridgePairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingBridgePairingDevice" (
    "id" TEXT NOT NULL,
    "pairingId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagingBridgePairingDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagingBridgeBinding" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "bridgeAgentId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "acquisitionType" TEXT NOT NULL DEFAULT 'folder_watch',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastValidatedAt" TIMESTAMP(3),
    "lastErrorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingBridgeBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgeAgent_installationId_key" ON "ImagingBridgeAgent"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgeAgent_createdWithPairingId_key" ON "ImagingBridgeAgent"("createdWithPairingId");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgePairing_codeHash_key" ON "ImagingBridgePairing"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgePairing_bridgeAgentId_key" ON "ImagingBridgePairing"("bridgeAgentId");

-- CreateIndex
CREATE INDEX "ImagingBridgePairing_clinicId_idx" ON "ImagingBridgePairing"("clinicId");

-- CreateIndex
CREATE INDEX "ImagingBridgePairing_expiresAt_idx" ON "ImagingBridgePairing"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgePairingDevice_pairingId_deviceId_key" ON "ImagingBridgePairingDevice"("pairingId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgeBinding_bridgeAgentId_deviceId_key" ON "ImagingBridgeBinding"("bridgeAgentId", "deviceId");

-- CreateIndex
CREATE INDEX "ImagingBridgeBinding_clinicId_idx" ON "ImagingBridgeBinding"("clinicId");

-- AddForeignKey
ALTER TABLE "ImagingBridgeAgent" ADD CONSTRAINT "ImagingBridgeAgent_createdWithPairingId_fkey" FOREIGN KEY ("createdWithPairingId") REFERENCES "ImagingBridgePairing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingBridgePairing" ADD CONSTRAINT "ImagingBridgePairing_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingBridgePairing" ADD CONSTRAINT "ImagingBridgePairing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingBridgePairingDevice" ADD CONSTRAINT "ImagingBridgePairingDevice_pairingId_fkey" FOREIGN KEY ("pairingId") REFERENCES "ImagingBridgePairing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingBridgeBinding" ADD CONSTRAINT "ImagingBridgeBinding_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingBridgeBinding" ADD CONSTRAINT "ImagingBridgeBinding_bridgeAgentId_fkey" FOREIGN KEY ("bridgeAgentId") REFERENCES "ImagingBridgeAgent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
