-- Smart patient recovery and recall system.

CREATE TABLE "ClinicRecallSetting" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultActionMode" TEXT NOT NULL DEFAULT 'LIST_ONLY',
    "checkupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkupAfterDays" INTEGER NOT NULL DEFAULT 180,
    "checkupSendTiming" TEXT NOT NULL DEFAULT 'MANUAL',
    "checkupSendTime" TEXT NOT NULL DEFAULT '10:00',
    "checkupActionMode" TEXT NOT NULL DEFAULT 'LIST_ONLY',
    "checkupMessageTemplateId" TEXT,
    "treatmentPlanFollowupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "treatmentPlanFollowupAfterDays" INTEGER NOT NULL DEFAULT 7,
    "treatmentPlanFollowupRepeatDays" INTEGER NOT NULL DEFAULT 14,
    "treatmentPlanFollowupMaxAttempts" INTEGER NOT NULL DEFAULT 3,
    "treatmentPlanFollowupActionMode" TEXT NOT NULL DEFAULT 'CREATE_TASK',
    "treatmentPlanFollowupMessageTemplateId" TEXT,
    "incompleteTreatmentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "incompleteTreatmentAfterDays" INTEGER NOT NULL DEFAULT 14,
    "incompleteTreatmentActionMode" TEXT NOT NULL DEFAULT 'CREATE_TASK',
    "incompleteTreatmentMessageTemplateId" TEXT,
    "incompleteTreatmentAutoCreateTask" BOOLEAN NOT NULL DEFAULT true,
    "noShowFollowupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "noShowFollowupAfterHours" INTEGER NOT NULL DEFAULT 24,
    "noShowFollowupActionMode" TEXT NOT NULL DEFAULT 'CREATE_TASK',
    "noShowFollowupMessageTemplateId" TEXT,
    "noShowFollowupAutoCreateTask" BOOLEAN NOT NULL DEFAULT true,
    "paymentFollowupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentFollowupAfterDays" INTEGER NOT NULL DEFAULT 3,
    "paymentFollowupActionMode" TEXT NOT NULL DEFAULT 'CREATE_TASK',
    "paymentFollowupMessageTemplateId" TEXT,
    "respectCommunicationConsent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicRecallSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecallCandidate" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recallType" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "treatmentCaseId" TEXT,
    "treatmentPlanProcedureId" TEXT,
    "appointmentId" TEXT,
    "paymentId" TEXT,
    "estimatedValue" DOUBLE PRECISION,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lastContactedAt" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "assignedToId" TEXT,
    "messageTemplateId" TEXT,
    "lastMessageDraft" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "RecallCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecallAction" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "performedById" TEXT,
    "taskId" TEXT,
    "messageId" TEXT,
    "appointmentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicRecallSetting_clinicId_key" ON "ClinicRecallSetting"("clinicId");
CREATE INDEX "ClinicRecallSetting_clinicId_idx" ON "ClinicRecallSetting"("clinicId");

CREATE INDEX "RecallCandidate_clinicId_status_dueAt_idx" ON "RecallCandidate"("clinicId", "status", "dueAt");
CREATE INDEX "RecallCandidate_clinicId_recallType_status_idx" ON "RecallCandidate"("clinicId", "recallType", "status");
CREATE INDEX "RecallCandidate_clinicId_patientId_idx" ON "RecallCandidate"("clinicId", "patientId");
CREATE INDEX "RecallCandidate_clinicId_sourceType_sourceId_idx" ON "RecallCandidate"("clinicId", "sourceType", "sourceId");
CREATE INDEX "RecallCandidate_assignedToId_idx" ON "RecallCandidate"("assignedToId");

CREATE UNIQUE INDEX "RecallCandidate_active_source_key"
ON "RecallCandidate"("clinicId", "patientId", "recallType", "sourceType", "sourceId")
WHERE "status" IN ('PENDING', 'TASK_CREATED', 'MESSAGE_DRAFTED', 'CONTACTED', 'SNOOZED');

CREATE INDEX "RecallAction_clinicId_candidateId_idx" ON "RecallAction"("clinicId", "candidateId");
CREATE INDEX "RecallAction_clinicId_patientId_idx" ON "RecallAction"("clinicId", "patientId");
CREATE INDEX "RecallAction_clinicId_actionType_createdAt_idx" ON "RecallAction"("clinicId", "actionType", "createdAt");

ALTER TABLE "ClinicRecallSetting" ADD CONSTRAINT "ClinicRecallSetting_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_treatmentCaseId_fkey" FOREIGN KEY ("treatmentCaseId") REFERENCES "TreatmentCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_treatmentPlanProcedureId_fkey" FOREIGN KEY ("treatmentPlanProcedureId") REFERENCES "TreatmentPlanProcedure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallCandidate" ADD CONSTRAINT "RecallCandidate_messageTemplateId_fkey" FOREIGN KEY ("messageTemplateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "RecallCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecallAction" ADD CONSTRAINT "RecallAction_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
