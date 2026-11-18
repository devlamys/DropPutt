-- The launch promo flag (SPEC §12) changes no amount any more, and push tokens live only in
-- device_registrations; nothing writes or reads these columns.
ALTER TABLE "franchises" DROP COLUMN "is_launch_promo_active";
ALTER TABLE "users" DROP COLUMN "fcm_token";
ALTER TABLE "customers" DROP COLUMN "fcm_token";
