-- Far deliveries: a minimum food order per distance band, an optional delivery discount,
-- and a wider delivery area (default 14 km; franchises still on the old default of 8 km move up).
ALTER TABLE "zones" ADD COLUMN "min_order_value" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "franchises" ADD COLUMN "delivery_discount_min" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "franchises" ADD COLUMN "delivery_discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "franchises" ALTER COLUMN "max_delivery_km" SET DEFAULT 14;
UPDATE "franchises" SET "max_delivery_km" = 14 WHERE "max_delivery_km" = 8;
