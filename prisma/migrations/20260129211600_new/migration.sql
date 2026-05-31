-- DropIndex
DROP INDEX "LedgerEntry_leadsPipelineId_type_key";

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "isPartial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudentPayout" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LedgerEntry_leadsPipelineId_type_idx" ON "LedgerEntry"("leadsPipelineId", "type");
