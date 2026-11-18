-- AlterTable
ALTER TABLE "franchises" ADD COLUMN     "extra_stop_fee" DECIMAL(12,2) NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "group_id" TEXT,
ADD COLUMN     "group_delivery_fee" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "orders_franchise_id_group_id_idx" ON "orders"("franchise_id", "group_id");
