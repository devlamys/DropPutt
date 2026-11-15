-- CreateEnum
CREATE TYPE "CashHandoverStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CashHandoverInitiator" AS ENUM ('RIDER', 'VENDOR', 'ADMIN');

-- CreateTable
CREATE TABLE "rider_cash_handovers" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "rider_id" INTEGER NOT NULL,
    "vendor_id" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "CashHandoverStatus" NOT NULL DEFAULT 'PENDING',
    "initiated_by" "CashHandoverInitiator" NOT NULL,
    "cash_before" DECIMAL(12,2),
    "cash_after" DECIMAL(12,2),
    "note" TEXT,
    "resolved_by" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rider_cash_handovers_franchise_id_status_created_at_idx" ON "rider_cash_handovers"("franchise_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "rider_cash_handovers_vendor_id_status_idx" ON "rider_cash_handovers"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "rider_cash_handovers_rider_id_created_at_idx" ON "rider_cash_handovers"("rider_id", "created_at");

-- AddForeignKey
ALTER TABLE "rider_cash_handovers" ADD CONSTRAINT "rider_cash_handovers_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cash_handovers" ADD CONSTRAINT "rider_cash_handovers_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cash_handovers" ADD CONSTRAINT "rider_cash_handovers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
