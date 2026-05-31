/*
  Warnings:

  - Added the required column `password` to the `Client` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "password" TEXT NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "panNumber" TEXT,
ADD COLUMN     "panVerified" BOOLEAN NOT NULL DEFAULT false;
