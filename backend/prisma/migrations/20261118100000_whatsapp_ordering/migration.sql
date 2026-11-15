-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('WEB', 'WHATSAPP');

-- AlterTable
ALTER TABLE "franchises" ADD COLUMN     "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_phone_number_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" SERIAL NOT NULL,
    "franchise_id" INTEGER NOT NULL,
    "wa_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'START',
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_inbound" (
    "wamid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_pkey" PRIMARY KEY ("wamid")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_franchise_id_wa_id_key" ON "whatsapp_sessions"("franchise_id", "wa_id");

-- CreateIndex
CREATE INDEX "whatsapp_inbound_created_at_idx" ON "whatsapp_inbound"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "franchises_whatsapp_phone_number_id_key" ON "franchises"("whatsapp_phone_number_id");

-- AddForeignKey
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

