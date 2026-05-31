/*
  Warnings:

  - A unique constraint covering the columns `[leadsPipelineId,type]` on the table `LedgerEntry` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BANNED');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'negotiating';

-- DropForeignKey
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_leadsPipelineId_fkey";

-- AlterTable
ALTER TABLE "LedgerEntry" ALTER COLUMN "leadsPipelineId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_leadsPipelineId_type_key" ON "LedgerEntry"("leadsPipelineId", "type");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_leadsPipelineId_fkey" FOREIGN KEY ("leadsPipelineId") REFERENCES "LeadsPipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
