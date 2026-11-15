-- AlterTable
ALTER TABLE "franchises" ADD COLUMN     "default_commission_rate" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "commission_rate" SET DEFAULT 10;

