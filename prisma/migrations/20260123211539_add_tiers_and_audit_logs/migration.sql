/*
  Warnings:

  - You are about to drop the column `ledgerEntryId` on the `StudentPayout` table. All the data in the column will be lost.
  - You are about to drop the column `paidAt` on the `StudentPayout` table. All the data in the column will be lost.
  - You are about to drop the column `reference` on the `StudentPayout` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `StudentPayout` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'scheduled', 'processing', 'completed', 'failed');

-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'payout_sent';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'paypal';
ALTER TYPE "PaymentMethod" ADD VALUE 'other';
ALTER TYPE "PaymentMethod" ADD VALUE 'bank_transfer';

-- DropForeignKey
ALTER TABLE "StudentPayout" DROP CONSTRAINT "StudentPayout_ledgerEntryId_fkey";

-- DropIndex
DROP INDEX "StudentPayout_ledgerEntryId_key";

-- AlterTable
ALTER TABLE "LeadsPipeline" ADD COLUMN     "paymentDueDate" TIMESTAMP(3),
ADD COLUMN     "paymentReceivedDate" TIMESTAMP(3),
ADD COLUMN     "payoutCompletedDate" TIMESTAMP(3),
ADD COLUMN     "payoutScheduledDate" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "payoutId" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "bankDetails" JSONB DEFAULT '{}',
ADD COLUMN     "partnerTierId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "paymentMethod" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StudentPayout" DROP COLUMN "ledgerEntryId",
DROP COLUMN "paidAt",
DROP COLUMN "reference",
ADD COLUMN     "completedDate" TIMESTAMP(3),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentDetails" JSONB DEFAULT '{}',
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "proofUrl" TEXT,
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "amount" SET DEFAULT 0,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(65,30);

-- CreateTable
CREATE TABLE "PartnerTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minReferrals" INTEGER NOT NULL DEFAULT 0,
    "minRevenue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commissionPercentage" DECIMAL(65,30) NOT NULL DEFAULT 5,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "icon" TEXT,
    "benefits" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "metadata" JSONB DEFAULT '{}',
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerTier_name_key" ON "PartnerTier"("name");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_partnerTierId_fkey" FOREIGN KEY ("partnerTierId") REFERENCES "PartnerTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "StudentPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
