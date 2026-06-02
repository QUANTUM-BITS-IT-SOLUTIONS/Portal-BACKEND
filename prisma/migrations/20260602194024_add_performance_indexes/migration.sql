-- CreateIndex
CREATE INDEX "Client_studentId_idx" ON "Client"("studentId");

-- CreateIndex
CREATE INDEX "Client_createdAt_idx" ON "Client"("createdAt");

-- CreateIndex
CREATE INDEX "LeadsPipeline_studentId_idx" ON "LeadsPipeline"("studentId");

-- CreateIndex
CREATE INDEX "LeadsPipeline_clientId_idx" ON "LeadsPipeline"("clientId");

-- CreateIndex
CREATE INDEX "LeadsPipeline_status_idx" ON "LeadsPipeline"("status");

-- CreateIndex
CREATE INDEX "LeadsPipeline_commissionStatus_idx" ON "LeadsPipeline"("commissionStatus");

-- CreateIndex
CREATE INDEX "LeadsPipeline_createdAt_idx" ON "LeadsPipeline"("createdAt");

-- CreateIndex
CREATE INDEX "LeadsPipeline_studentId_status_idx" ON "LeadsPipeline"("studentId", "status");

-- CreateIndex
CREATE INDEX "LeadsPipeline_studentId_commissionStatus_idx" ON "LeadsPipeline"("studentId", "commissionStatus");

-- CreateIndex
CREATE INDEX "LedgerEntry_studentId_idx" ON "LedgerEntry"("studentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_studentId_type_idx" ON "LedgerEntry"("studentId", "type");

-- CreateIndex
CREATE INDEX "Notification_studentId_idx" ON "Notification"("studentId");

-- CreateIndex
CREATE INDEX "Notification_read_idx" ON "Notification"("read");

-- CreateIndex
CREATE INDEX "Notification_studentId_read_idx" ON "Notification"("studentId", "read");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Student_partnerTierId_idx" ON "Student"("partnerTierId");

-- CreateIndex
CREATE INDEX "Student_status_idx" ON "Student"("status");

-- CreateIndex
CREATE INDEX "StudentPayout_studentId_idx" ON "StudentPayout"("studentId");

-- CreateIndex
CREATE INDEX "StudentPayout_status_idx" ON "StudentPayout"("status");

-- CreateIndex
CREATE INDEX "StudentPayout_studentId_status_idx" ON "StudentPayout"("studentId", "status");

-- CreateIndex
CREATE INDEX "StudentPayout_createdAt_idx" ON "StudentPayout"("createdAt");
