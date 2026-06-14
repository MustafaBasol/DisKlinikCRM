-- AlterTable: add Meta WhatsApp template management fields to MessageTemplate
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateName" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateLanguage" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateCategory" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateStatus" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateId" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateRejectionReason" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateLastSyncedAt" TIMESTAMP(3);
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateSubmittedAt" TIMESTAMP(3);
ALTER TABLE "MessageTemplate" ADD COLUMN "metaTemplateVariableMap" JSONB;
