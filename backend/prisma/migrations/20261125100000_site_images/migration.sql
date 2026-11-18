-- CreateTable
CREATE TABLE "site_images" (
    "id" SERIAL NOT NULL,
    "slot" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_images_slot_key" ON "site_images"("slot");
