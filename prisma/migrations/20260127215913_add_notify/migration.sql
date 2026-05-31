-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'approved', 'held', 'rejected', 'paid');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadStatus" ADD VALUE 'lead_added';
ALTER TYPE "LeadStatus" ADD VALUE 'team_approval';
ALTER TYPE "LeadStatus" ADD VALUE 'payment_link';
ALTER TYPE "LeadStatus" ADD VALUE 'invoice';
ALTER TYPE "LeadStatus" ADD VALUE 'client_pays';
ALTER TYPE "LeadStatus" ADD VALUE 'work_starts';
ALTER TYPE "LeadStatus" ADD VALUE 'commission_approved';
ALTER TYPE "LeadStatus" ADD VALUE 'commission_paid';

-- AlterTable
ALTER TABLE "LeadsPipeline" ADD COLUMN     "commissionStatus" "CommissionStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentPercentage" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "paymentType" TEXT NOT NULL DEFAULT 'full';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "readAt" TIMESTAMP(3);
