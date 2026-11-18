-- AlterTable
ALTER TABLE "franchises" ADD COLUMN     "address" TEXT,
ADD COLUMN     "lat" DECIMAL(9,6),
ADD COLUMN     "lng" DECIMAL(9,6);
