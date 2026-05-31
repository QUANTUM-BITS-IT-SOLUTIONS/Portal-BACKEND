/*
  Warnings:

  - The values [commission_paid] on the enum `LeadStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "LeadStatus_new" AS ENUM ('pending', 'payment_sent', 'paid', 'cancelled', 'negotiating', 'lead_added', 'team_approval', 'payment_link', 'invoice', 'client_pays', 'work_starts', 'commission_approved');
ALTER TABLE "LeadsPipeline" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "LeadsPipeline" ALTER COLUMN "status" TYPE "LeadStatus_new" USING ("status"::text::"LeadStatus_new");
ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";
ALTER TYPE "LeadStatus_new" RENAME TO "LeadStatus";
DROP TYPE "LeadStatus_old";
ALTER TABLE "LeadsPipeline" ALTER COLUMN "status" SET DEFAULT 'pending';
COMMIT;
