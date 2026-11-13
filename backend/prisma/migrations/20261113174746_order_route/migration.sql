-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "route" JSONB,
ADD COLUMN     "route_updated_at" TIMESTAMP(3);
