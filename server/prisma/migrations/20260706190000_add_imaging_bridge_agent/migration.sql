-- CreateTable
CREATE TABLE "ImagingBridgeAgent" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastSeenAt" TIMESTAMP(3),
    "agentVersion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImagingBridgeAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImagingBridgeAgent_tokenHash_key" ON "ImagingBridgeAgent"("tokenHash");

-- CreateIndex
CREATE INDEX "ImagingBridgeAgent_clinicId_idx" ON "ImagingBridgeAgent"("clinicId");

-- AddForeignKey
ALTER TABLE "ImagingBridgeAgent" ADD CONSTRAINT "ImagingBridgeAgent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagingBridgeAgent" ADD CONSTRAINT "ImagingBridgeAgent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
