-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('CASH', 'UPI', 'BANK', 'NETTED');

-- AlterEnum
ALTER TYPE "SettlementType" ADD VALUE 'PAID_FROM_CASH';

-- CreateTable
CREATE TABLE "rider_payouts" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "rider_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PayoutMethod" NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "wallet_before" DECIMAL(12,2) NOT NULL,
    "wallet_after" DECIMAL(12,2) NOT NULL,
    "recorded_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_payouts_franchise_id_created_at_idx" ON "rider_payouts"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "rider_payouts_rider_id_created_at_idx" ON "rider_payouts"("rider_id", "created_at");

-- AddForeignKey
ALTER TABLE "rider_payouts" ADD CONSTRAINT "rider_payouts_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_payouts" ADD CONSTRAINT "rider_payouts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

