-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'FRANCHISE_ADMIN', 'VENDOR', 'RIDER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ShopCategory" AS ENUM ('HOTEL', 'BAKERY_COOLBAR', 'GROCERY', 'FISH_MEAT', 'MEDICAL_PHARMACY');

-- CreateEnum
CREATE TYPE "TimeSlot" AS ENUM ('ALL_DAY', 'LUNCH_ONLY', 'EVENING_SNACKS_3_TO_6', 'DINNER_ONLY');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BIKE', 'SCOOTER', 'AUTO', 'MINI_TRUCK');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('HOTEL_DIRECT', 'FOOD_MARKETPLACE', 'CUSTOM_BUY', 'PICK_DROP', 'MINI_TRUCK');

-- CreateEnum
CREATE TYPE "OrderCategory" AS ENUM ('FOOD', 'EVENING_SNACKS', 'GROCERY', 'FISH_MEAT', 'MEDICAL', 'PICK_DROP');

-- CreateEnum
CREATE TYPE "DeliveryHandledBy" AS ENUM ('PLATFORM_RIDER', 'VENDOR_STAFF');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'PREPAID_AT_HOTEL', 'UPI_TO_ADMIN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('RIDER_REQUESTED', 'RIDER_ASSIGNED', 'PICKED_UP', 'LOCATION_SHARED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "SettlementParty" AS ENUM ('RIDER_CASH', 'RIDER_EARNING', 'VENDOR_PAYABLE', 'FRANCHISE_PROFIT', 'SUPER_ADMIN_ROYALTY');

-- CreateEnum
CREATE TYPE "SettlementType" AS ENUM ('ORDER_PAYMENT', 'ORDER_DELIVERY', 'RIDER_TIP', 'RAIN_SURGE', 'VENDOR_PAYABLE', 'ROYALTY', 'MILESTONE_BONUS', 'REVERSAL');

-- CreateTable
CREATE TABLE "franchises" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "wallet_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "min_balance_limit" DECIMAL(12,2) NOT NULL DEFAULT -50,
    "royalty_per_order" DECIMAL(12,2) NOT NULL DEFAULT 3,
    "is_launch_promo_active" BOOLEAN NOT NULL DEFAULT false,
    "rain_surge_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "daily_milestone_target" INTEGER NOT NULL DEFAULT 20,
    "daily_milestone_bonus" DECIMAL(12,2) NOT NULL DEFAULT 50,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "type" "WalletTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "fcm_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "shop_name" TEXT NOT NULL,
    "shop_category" "ShopCategory" NOT NULL DEFAULT 'HOTEL',
    "address" TEXT NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "commission_rate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "min_order_value" DECIMAL(12,2) NOT NULL DEFAULT 150,
    "upi_id" TEXT,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "admin_payable_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "image_url" TEXT,
    "slot_type" "TimeSlot" NOT NULL DEFAULT 'ALL_DAY',
    "available_from" TEXT,
    "available_to" TEXT,
    "is_combo" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL DEFAULT 'BIKE',
    "vehicle_number" TEXT NOT NULL,
    "license_number" TEXT NOT NULL,
    "kyc_document_url" TEXT,
    "insurance_expiry" TIMESTAMP(3) NOT NULL,
    "emergency_contact" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "max_active_orders" INTEGER NOT NULL DEFAULT 2,
    "cash_in_hand" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_cash_limit" DECIMAL(12,2) NOT NULL DEFAULT 1500,
    "wallet_earnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "security_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "current_lat" DECIMAL(10,7),
    "current_lng" DECIMAL(10,7),
    "last_location_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "turning_point" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "gps_accuracy" DECIMAL(8,2),
    "verified_lat" DECIMAL(10,7),
    "verified_lng" DECIMAL(10,7),
    "is_location_verified" BOOLEAN NOT NULL DEFAULT false,
    "voice_direction_url" TEXT,
    "house_image_url" TEXT,
    "rider_delivery_note" TEXT,
    "fcm_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "zone_name" TEXT NOT NULL,
    "delivery_fee" DECIMAL(12,2) NOT NULL,
    "rider_commission" DECIMAL(12,2) NOT NULL,
    "franchise_profit" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "order_number" TEXT NOT NULL,
    "order_type" "OrderType" NOT NULL DEFAULT 'HOTEL_DIRECT',
    "order_category" "OrderCategory" NOT NULL DEFAULT 'FOOD',
    "delivery_handled_by" "DeliveryHandledBy" NOT NULL DEFAULT 'PLATFORM_RIDER',
    "vendor_id" INTEGER,
    "rider_id" INTEGER,
    "zone_id" INTEGER,
    "customer_phone" TEXT,
    "customer_name" TEXT,
    "custom_shop_name" TEXT,
    "custom_items_text" TEXT,
    "rider_paid_at_shop" BOOLEAN NOT NULL DEFAULT false,
    "shop_markup_profit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bill_image_url" TEXT,
    "prescription_img_url" TEXT,
    "voice_note_url" TEXT,
    "location_token" TEXT NOT NULL,
    "pickup_address" TEXT,
    "pickup_lat" DECIMAL(10,7),
    "pickup_lng" DECIMAL(10,7),
    "drop_address" TEXT,
    "turning_point" TEXT,
    "drop_lat" DECIMAL(10,7),
    "drop_lng" DECIMAL(10,7),
    "item_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rider_tip" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vendor_commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vendor_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rider_earning" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "franchise_profit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "super_admin_profit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_to_collect" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vendor_admin_payable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rain_surge_applied" BOOLEAN NOT NULL DEFAULT false,
    "royalty_deducted" BOOLEAN NOT NULL DEFAULT false,
    "settlement_completed" BOOLEAN NOT NULL DEFAULT false,
    "is_batched_addon" BOOLEAN NOT NULL DEFAULT false,
    "payment_method" "PaymentMethod" NOT NULL DEFAULT 'COD',
    "order_status" "OrderStatus" NOT NULL DEFAULT 'RIDER_REQUESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_campaigns" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cron_time" TEXT NOT NULL DEFAULT '0 16 * * *',
    "target_slot" "TimeSlot" NOT NULL DEFAULT 'EVENING_SNACKS_3_TO_6',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_entries" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "vendor_id" INTEGER,
    "rider_id" INTEGER,
    "party" "SettlementParty" NOT NULL,
    "type" "SettlementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_registrations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "customer_id" INTEGER,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "fcm_token" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "franchise_id" INTEGER,
    "user_id" INTEGER,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "franchises_slug_key" ON "franchises"("slug");

-- CreateIndex
CREATE INDEX "wallet_transactions_franchise_id_created_at_idx" ON "wallet_transactions"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_order_id_idx" ON "wallet_transactions"("order_id");

-- CreateIndex
CREATE INDEX "users_franchise_id_role_idx" ON "users"("franchise_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_franchise_id_phone_key" ON "users"("franchise_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- CreateIndex
CREATE INDEX "vendors_franchise_id_shop_category_is_open_idx" ON "vendors"("franchise_id", "shop_category", "is_open");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_franchise_id_shop_name_key" ON "vendors"("franchise_id", "shop_name");

-- CreateIndex
CREATE INDEX "products_vendor_id_is_available_idx" ON "products"("vendor_id", "is_available");

-- CreateIndex
CREATE INDEX "products_vendor_id_slot_type_is_available_idx" ON "products"("vendor_id", "slot_type", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "riders_user_id_key" ON "riders"("user_id");

-- CreateIndex
CREATE INDEX "riders_franchise_id_is_online_is_approved_idx" ON "riders"("franchise_id", "is_online", "is_approved");

-- CreateIndex
CREATE INDEX "customers_franchise_id_updated_at_idx" ON "customers"("franchise_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_franchise_id_phone_key" ON "customers"("franchise_id", "phone");

-- CreateIndex
CREATE INDEX "zones_franchise_id_idx" ON "zones"("franchise_id");

-- CreateIndex
CREATE UNIQUE INDEX "zones_franchise_id_zone_name_key" ON "zones"("franchise_id", "zone_name");

-- CreateIndex
CREATE UNIQUE INDEX "orders_location_token_key" ON "orders"("location_token");

-- CreateIndex
CREATE INDEX "orders_franchise_id_order_status_created_at_idx" ON "orders"("franchise_id", "order_status", "created_at");

-- CreateIndex
CREATE INDEX "orders_franchise_id_rider_id_order_status_idx" ON "orders"("franchise_id", "rider_id", "order_status");

-- CreateIndex
CREATE INDEX "orders_franchise_id_vendor_id_order_status_idx" ON "orders"("franchise_id", "vendor_id", "order_status");

-- CreateIndex
CREATE INDEX "orders_franchise_id_customer_phone_idx" ON "orders"("franchise_id", "customer_phone");

-- CreateIndex
CREATE INDEX "orders_franchise_id_zone_id_order_status_idx" ON "orders"("franchise_id", "zone_id", "order_status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_franchise_id_order_number_key" ON "orders"("franchise_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_id_key" ON "order_items"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "push_campaigns_franchise_id_is_active_idx" ON "push_campaigns"("franchise_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_entries_reference_key_key" ON "settlement_entries"("reference_key");

-- CreateIndex
CREATE INDEX "settlement_entries_franchise_id_created_at_idx" ON "settlement_entries"("franchise_id", "created_at");

-- CreateIndex
CREATE INDEX "settlement_entries_order_id_type_idx" ON "settlement_entries"("order_id", "type");

-- CreateIndex
CREATE INDEX "settlement_entries_vendor_id_created_at_idx" ON "settlement_entries"("vendor_id", "created_at");

-- CreateIndex
CREATE INDEX "settlement_entries_rider_id_created_at_idx" ON "settlement_entries"("rider_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_fcm_token_key" ON "device_registrations"("fcm_token");

-- CreateIndex
CREATE INDEX "device_registrations_user_id_idx" ON "device_registrations"("user_id");

-- CreateIndex
CREATE INDEX "device_registrations_customer_id_idx" ON "device_registrations"("customer_id");

-- CreateIndex
CREATE INDEX "device_registrations_fcm_token_idx" ON "device_registrations"("fcm_token");

-- CreateIndex
CREATE INDEX "device_registrations_is_active_last_seen_at_idx" ON "device_registrations"("is_active", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_key_key" ON "idempotency_records"("key");

-- CreateIndex
CREATE INDEX "idempotency_records_key_expires_at_idx" ON "idempotency_records"("key", "expires_at");

-- CreateIndex
CREATE INDEX "idempotency_records_franchise_id_idx" ON "idempotency_records"("franchise_id");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_campaigns" ADD CONSTRAINT "push_campaigns_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_entries" ADD CONSTRAINT "settlement_entries_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
