-- CreateEnum
CREATE TYPE "FoodCategory" AS ENUM ('MEALS', 'BIRYANI', 'FAST_FOOD', 'SNACKS', 'JUICE_SHAKES', 'BAKERY_SWEETS', 'OTHER');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "food_category" "FoodCategory" NOT NULL DEFAULT 'OTHER';

-- Best-effort guess for existing items from their name (vendors can change it).
UPDATE "products" SET "food_category" = 'BIRYANI'      WHERE "name" ~* 'biriyani|biryani|ബിരിയാണി|mandi|kuzhi';
UPDATE "products" SET "food_category" = 'JUICE_SHAKES' WHERE "food_category" = 'OTHER' AND "name" ~* 'juice|shake|lime|soda|lassi|falooda|mojito|ജ്യൂസ്';
UPDATE "products" SET "food_category" = 'FAST_FOOD'    WHERE "food_category" = 'OTHER' AND "name" ~* 'burger|pizza|wrap|sandwich|fries|shawarma|roll|noodles|fried rice|momo|nugget';
UPDATE "products" SET "food_category" = 'BAKERY_SWEETS' WHERE "food_category" = 'OTHER' AND "name" ~* 'cake|puff|bun|cookie|brownie|ice cream|dessert|pudding|sweet|laddu|halwa';
UPDATE "products" SET "food_category" = 'SNACKS'       WHERE "food_category" = 'OTHER' AND ("slot_type" = 'EVENING_SNACKS_3_TO_6' OR "name" ~* 'chai|tea|coffee|vada|bonda|pazham|samosa|cutlet|pakoda|unniyappam|ചായ|കടി');
UPDATE "products" SET "food_category" = 'MEALS'        WHERE "food_category" = 'OTHER' AND "name" ~* 'meals|thali|parotta|porotta|appam|dosa|idli|puttu|curry|fry|chicken|beef|fish|egg|ഊണ്';
