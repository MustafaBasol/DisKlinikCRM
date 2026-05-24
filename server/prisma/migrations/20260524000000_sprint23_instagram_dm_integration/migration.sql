-- Sprint 23: Instagram DM Integration
-- Adds InstagramConnection, ClinicInstagramConnection, InstagramInboxEntry models

-- ── InstagramConnection ───────────────────────────────────────────────────────

CREATE TABLE "InstagramConnection" (
    "id"                      TEXT NOT NULL,
    "organizationId"          TEXT NOT NULL,
    "name"                    TEXT NOT NULL,
    "status"                  TEXT NOT NULL DEFAULT 'disconnected',
    "instagramAccountId"      TEXT,
    "instagramUsername"       TEXT,
    "facebookPageId"          TEXT,
    "accessTokenEncrypted"    TEXT,
    "pageAccessTokenEncrypted" TEXT,
    "webhookVerifyToken"      TEXT,
    "webhookSecret"           TEXT,
    "metaAppId"               TEXT,
    "metaBusinessId"          TEXT,
    "tokenStatus"             TEXT DEFAULT 'unknown',
    "tokenExpiresAt"          TIMESTAMP(3),
    "lastConnectedAt"         TIMESTAMP(3),
    "lastError"               TEXT,
    "isActive"                BOOLEAN NOT NULL DEFAULT true,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstagramConnection_organizationId_name_key"
    ON "InstagramConnection"("organizationId", "name");

CREATE INDEX "InstagramConnection_organizationId_idx"
    ON "InstagramConnection"("organizationId");

ALTER TABLE "InstagramConnection"
    ADD CONSTRAINT "InstagramConnection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── ClinicInstagramConnection ─────────────────────────────────────────────────

CREATE TABLE "ClinicInstagramConnection" (
    "id"                    TEXT NOT NULL,
    "organizationId"        TEXT NOT NULL,
    "clinicId"              TEXT NOT NULL,
    "instagramConnectionId" TEXT NOT NULL,
    "isDefault"             BOOLEAN NOT NULL DEFAULT true,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicInstagramConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicInstagramConnection_clinicId_instagramConnectionId_key"
    ON "ClinicInstagramConnection"("clinicId", "instagramConnectionId");

CREATE INDEX "ClinicInstagramConnection_organizationId_idx"
    ON "ClinicInstagramConnection"("organizationId");

CREATE INDEX "ClinicInstagramConnection_clinicId_idx"
    ON "ClinicInstagramConnection"("clinicId");

CREATE INDEX "ClinicInstagramConnection_instagramConnectionId_idx"
    ON "ClinicInstagramConnection"("instagramConnectionId");

ALTER TABLE "ClinicInstagramConnection"
    ADD CONSTRAINT "ClinicInstagramConnection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicInstagramConnection"
    ADD CONSTRAINT "ClinicInstagramConnection_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicInstagramConnection"
    ADD CONSTRAINT "ClinicInstagramConnection_instagramConnectionId_fkey"
    FOREIGN KEY ("instagramConnectionId") REFERENCES "InstagramConnection"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── InstagramInboxEntry ───────────────────────────────────────────────────────

CREATE TABLE "InstagramInboxEntry" (
    "id"                    TEXT NOT NULL,
    "organizationId"        TEXT NOT NULL,
    "instagramConnectionId" TEXT,
    "clinicId"              TEXT,
    "patientId"             TEXT,
    "resolvedByUserId"      TEXT,
    "externalSenderId"      TEXT NOT NULL,
    "externalConversationId" TEXT,
    "senderUsername"        TEXT,
    "lastMessageText"       TEXT,
    "messageCount"          INTEGER NOT NULL DEFAULT 1,
    "externalMessageId"     TEXT,
    "rawPayload"            JSONB,
    "needsClinicResolution" BOOLEAN NOT NULL DEFAULT false,
    "status"                TEXT NOT NULL DEFAULT 'open',
    "resolvedAt"            TIMESTAMP(3),
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramInboxEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InstagramInboxEntry_organizationId_needsClinicResolution_idx"
    ON "InstagramInboxEntry"("organizationId", "needsClinicResolution");

CREATE INDEX "InstagramInboxEntry_organizationId_status_idx"
    ON "InstagramInboxEntry"("organizationId", "status");

CREATE INDEX "InstagramInboxEntry_organizationId_clinicId_idx"
    ON "InstagramInboxEntry"("organizationId", "clinicId");

CREATE INDEX "InstagramInboxEntry_instagramConnectionId_externalSenderId_idx"
    ON "InstagramInboxEntry"("instagramConnectionId", "externalSenderId");

ALTER TABLE "InstagramInboxEntry"
    ADD CONSTRAINT "InstagramInboxEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InstagramInboxEntry"
    ADD CONSTRAINT "InstagramInboxEntry_instagramConnectionId_fkey"
    FOREIGN KEY ("instagramConnectionId") REFERENCES "InstagramConnection"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InstagramInboxEntry"
    ADD CONSTRAINT "InstagramInboxEntry_clinicId_fkey"
    FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InstagramInboxEntry"
    ADD CONSTRAINT "InstagramInboxEntry_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InstagramInboxEntry"
    ADD CONSTRAINT "InstagramInboxEntry_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
