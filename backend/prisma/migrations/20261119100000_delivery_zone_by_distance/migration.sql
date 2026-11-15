-- CreateEnum
CREATE TYPE "ZoneSource" AS ENUM ('AUTO', 'MANUAL', 'RIDER_OVERRIDE');

-- AlterTable
ALTER TABLE "franchises" ADD COLUMN     "max_delivery_km" DECIMAL(5,2) NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "max_km" DECIMAL(5,2),
ALTER COLUMN "rider_commission" SET DEFAULT 0,
ALTER COLUMN "franchise_profit" SET DEFAULT 0;

-- Existing zones only had their distance in the name: give each franchise's zones
-- 2 / 5 / 8 km by order of delivery fee (the franchise can edit them afterwards).
UPDATE "zones" z
SET "max_km" = CASE r.rn WHEN 1 THEN 2 WHEN 2 THEN 5 ELSE 8 END
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY franchise_id ORDER BY delivery_fee, id) AS rn
  FROM "zones"
) r
WHERE r.id = z.id;

ALTER TABLE "zones" ALTER COLUMN "max_km" SET NOT NULL;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "zone_source" "ZoneSource";

