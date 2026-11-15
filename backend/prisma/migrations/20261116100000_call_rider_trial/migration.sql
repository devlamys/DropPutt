-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "commission_free_until" TIMESTAMP(3),
ALTER COLUMN "commission_rate" SET DEFAULT 1;


-- Existing hotels keep today's commission-free Call Rider Now for 6 months.
UPDATE "vendors" SET "commission_free_until" = now() + interval '6 months';
