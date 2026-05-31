-- AlterTable
ALTER TABLE "LeadsPipeline" ADD COLUMN     "commissionRate" DECIMAL(65,30) NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Student" ALTER COLUMN "commissionPercent" SET DEFAULT 5,
ALTER COLUMN "commissionPercent" SET DATA TYPE DECIMAL(65,30);
