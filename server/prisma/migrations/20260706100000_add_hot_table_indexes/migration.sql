-- Migration: add_hot_table_indexes
-- Yük analizi (docs/45): Postgres'te Prisma FK kolonlarına otomatik indeks
-- koymadığından en sıcak tablolar (Appointment, SentMessage, Payment, Task,
-- ActivityLog) indekssizdi; takvim, uygunluk, dashboard ve reminder-job
-- sorguları tablo taraması yapıyordu. Purely additive — sadece CREATE INDEX.

-- Appointment: takvim (clinicId+startTime), doktor uygunluğu
-- (practitionerId+startTime), hasta detayı (patientId)
CREATE INDEX "Appointment_clinicId_startTime_idx" ON "Appointment"("clinicId", "startTime");
CREATE INDEX "Appointment_practitionerId_startTime_idx" ON "Appointment"("practitionerId", "startTime");
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- SentMessage: reminder-job dedup kontrolleri ve hasta mesaj geçmişi
CREATE INDEX "SentMessage_clinicId_appointmentId_createdAt_idx" ON "SentMessage"("clinicId", "appointmentId", "createdAt");
CREATE INDEX "SentMessage_clinicId_subject_idx" ON "SentMessage"("clinicId", "subject");
CREATE INDEX "SentMessage_patientId_idx" ON "SentMessage"("patientId");

-- Payment: finans dashboard'ları (clinicId+createdAt), hasta ödeme geçmişi
CREATE INDEX "Payment_clinicId_createdAt_idx" ON "Payment"("clinicId", "createdAt");
CREATE INDEX "Payment_patientId_idx" ON "Payment"("patientId");

-- Task: açık görev listeleri
CREATE INDEX "Task_clinicId_status_idx" ON "Task"("clinicId", "status");

-- ActivityLog: klinik aktivite akışı ve hasta zaman çizelgesi
CREATE INDEX "ActivityLog_clinicId_createdAt_idx" ON "ActivityLog"("clinicId", "createdAt");
CREATE INDEX "ActivityLog_patientId_idx" ON "ActivityLog"("patientId");
