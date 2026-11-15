-- CreateEnum
CREATE TYPE "VendorSettlementDirection" AS ENUM ('VENDOR_PAID_FRANCHISE', 'FRANCHISE_PAID_VENDOR');

-- CreateEnum
CREATE TYPE "SettlementMethod" AS ENUM ('CASH', 'UPI', 'BANK');

-- CreateTable
CREATE TABLE "vendor_settlements" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "direction" "VendorSettlementDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "SettlementMethod" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "period_from" TIMESTAMP(3),
    "period_to" TIMESTAMP(3),
    "balance_before" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "recorded_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_settlements_franchise_id_created_at_idx" ON "vendor_settlements"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_settlements_vendor_id_created_at_idx" ON "vendor_settlements"("vendor_id", "created_at");

-- AddForeignKey
ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

