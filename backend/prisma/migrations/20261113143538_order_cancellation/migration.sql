-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_role" TEXT,
ADD COLUMN     "last_dispatched_at" TIMESTAMP(3);
