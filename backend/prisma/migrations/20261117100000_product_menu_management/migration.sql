-- AlterTable
ALTER TABLE "products" ADD COLUMN     "description" TEXT,
ADD COLUMN     "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offer_ends_at" TIMESTAMP(3),
ADD COLUMN     "offer_label" TEXT,
ADD COLUMN     "offer_price" DECIMAL(12,2),
ADD COLUMN     "stock_qty" INTEGER;

