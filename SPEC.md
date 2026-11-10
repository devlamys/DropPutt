# SPEC.md — Multi-Franchise Hyperlocal Delivery, B2B Rider Calling & Rural Navigation Platform

## 1. Purpose

This specification defines the production architecture, PostgreSQL/Prisma data model, multi-tenant isolation rules, order lifecycle, rider concurrency controls, marketplace checkout, financial settlement, launch-promotion math, rain surge/tips, rural navigation, 4 PM Chayakadi automation, and Socket.io live tracking for a multi-franchise hyperlocal delivery platform.

The platform is designed for semi-urban and rural markets, beginning with Kizhissery, and supports franchise subdomains such as:

- `kizhissery.techkerala.in`
- `edavannappara.techkerala.in`
- `admin.techkerala.in`

The system MUST be tenant-safe: a customer, user, vendor, rider, order, product, wallet transaction, and operational record must never be accidentally read or mutated across franchises.

---

## 2. Non-Negotiable Production Rules

1. **Database:** PostgreSQL 15+ only.
2. **ORM:** Prisma.
3. **Money:** Never use JavaScript binary floating-point arithmetic for persisted financial calculations. Use Prisma `Decimal`/PostgreSQL `NUMERIC(12,2)` and a single money utility layer.
4. **Tenant isolation:** Every tenant-owned query MUST be scoped by `franchise_id`.
5. **Phone uniqueness:** `User.phone` and `Customer.phone` are unique only inside a franchise.
6. **Order itemization:** Marketplace orders MUST persist each product/quantity/unit-price/line-total through `OrderItem`.
7. **Financial formulas:** All four-way split values are calculated once during checkout/pickup and recalculated only by explicit financial events such as an approved tip or surge.
8. **Idempotency:** Pickup, tip, delivery, wallet deduction, and settlement operations MUST be protected against duplicate requests.
9. **Rider acceptance:** PostgreSQL row-level locking with `FOR UPDATE` MUST remain inside `prisma.$transaction`.
10. **Royalty:** One royalty deduction per successfully delivered order. Never deduct royalty twice because a request is retried.
11. **Rain surge:** `rain_surge_applied` MUST prevent duplicate surge additions.
12. **Tip:** Only `10`, `20`, or `30` INR is accepted per tip action, and the endpoint MUST be idempotent.
13. **GPS warning:** Accuracy worse than 50 metres MUST show the Malayalam indoor-GPS warning unless a voice route note is supplied.
14. **4 PM cron:** All cron times are Asia/Kolkata.
15. **Socket tracking:** Rider location events are emitted every 5 seconds during active deliveries, with tenant/order authorization.
16. **Public Magic Link:** The location token is opaque and unguessable; public endpoints expose only the minimum required order/tracking data.

---

## 3. System Architecture & Tech Stack

### Backend

- Node.js 20+
- Express.js
- Prisma ORM
- PostgreSQL 15+
- Socket.io
- `node-cron`
- Firebase Admin SDK / FCM
- Zod or equivalent request validation
- bcrypt/argon2 for PIN/password hashing
- JSON Web Tokens for authenticated staff/rider sessions

### Frontend

- React + Vite
- Tailwind CSS
- Lucide Icons
- `react-leaflet`
- Leaflet + OpenStreetMap
- Socket.io-client
- Axios
- `navigator.geolocation`
- `watchPosition`
- `MediaRecorder`
- `navigator.wakeLock`

### Storage

Cloudflare R2 or an equivalent S3-compatible object store for:

- bill photos
- voice route notes
- gate/house photos
- medical prescriptions
- KYC documents

Sensitive documents MUST NOT be returned directly from public endpoints.

---

## 4. API & Multi-Tenant Conventions

### API prefix

All application APIs use:

`/api/v1`

Public Magic Link endpoints use:

`/api/v1/public/drop/:token/...`

### Required franchise header

Every authenticated/customer frontend API request MUST send:

`x-franchise-slug: <subdomain-slug>`

Example:

`x-franchise-slug: kizhissery`

The backend:

1. normalizes the slug;
2. loads the active franchise;
3. sets `req.franchise_id`;
4. rejects inactive/non-existent franchises;
5. uses `req.franchise_id` in every tenant-owned database query.

Never trust a client-supplied `franchise_id` body field.

### Database naming

- PostgreSQL columns: `snake_case`
- Prisma model fields: `snake_case`
- JSON payloads: `snake_case`
- Routes: kebab-case where appropriate

---

# 5. Complete Production Prisma Schema

The following is the authoritative `prisma/schema.prisma`.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  SUPER_ADMIN
  FRANCHISE_ADMIN
  VENDOR
  RIDER
  CUSTOMER
}

enum ShopCategory {
  HOTEL
  BAKERY_COOLBAR
  GROCERY
  FISH_MEAT
  MEDICAL_PHARMACY
}

enum TimeSlot {
  ALL_DAY
  LUNCH_ONLY
  EVENING_SNACKS_3_TO_6
  DINNER_ONLY
}

enum VehicleType {
  BIKE
  SCOOTER
  AUTO
  MINI_TRUCK
}

enum OrderType {
  HOTEL_DIRECT
  FOOD_MARKETPLACE
  CUSTOM_BUY
  PICK_DROP
  MINI_TRUCK
}

enum OrderCategory {
  FOOD
  EVENING_SNACKS
  GROCERY
  FISH_MEAT
  MEDICAL
  PICK_DROP
}

enum DeliveryHandledBy {
  PLATFORM_RIDER
  VENDOR_STAFF
}

enum PaymentMethod {
  COD
  PREPAID_AT_HOTEL
  UPI_TO_ADMIN
}

enum OrderStatus {
  RIDER_REQUESTED
  RIDER_ASSIGNED
  PICKED_UP
  LOCATION_SHARED
  DELIVERED
  CANCELLED
}

enum WalletTxType {
  CREDIT
  DEBIT
}

enum SettlementParty {
  RIDER_CASH
  RIDER_EARNING
  VENDOR_PAYABLE
  FRANCHISE_PROFIT
  SUPER_ADMIN_ROYALTY
}

enum SettlementType {
  ORDER_PAYMENT
  ORDER_DELIVERY
  RIDER_TIP
  RAIN_SURGE
  VENDOR_PAYABLE
  ROYALTY
  MILESTONE_BONUS
  REVERSAL
}

model Franchise {
  id                     Int      @id @default(autoincrement())
  name                   String
  slug                   String   @unique
  wallet_balance         Decimal  @default(0) @db.Decimal(12, 2)
  min_balance_limit      Decimal  @default(-50) @db.Decimal(12, 2)
  royalty_per_order      Decimal  @default(3) @db.Decimal(12, 2)
  is_launch_promo_active Boolean  @default(false)
  rain_surge_fee         Decimal  @default(0) @db.Decimal(12, 2)
  daily_milestone_target Int      @default(20)
  daily_milestone_bonus  Decimal  @default(50) @db.Decimal(12, 2)
  is_active              Boolean  @default(true)
  created_at             DateTime @default(now())

  users               User[]
  vendors             Vendor[]
  riders              Rider[]
  customers           Customer[]
  zones               Zone[]
  orders              Order[]
  wallet_transactions WalletTransaction[]
  push_campaigns      PushCampaigns[]
  settlement_entries  SettlementEntry[]

  @@map("franchises")
}

model WalletTransaction {
  id            Int      @id @default(autoincrement())
  franchise_id  Int
  order_id      Int?
  type          WalletTxType
  amount        Decimal  @db.Decimal(12, 2)
  balance_after Decimal  @db.Decimal(12, 2)
  description   String
  created_at    DateTime @default(now())

  franchise Franchise @relation(fields: [franchise_id], references: [id])
  order     Order?    @relation(fields: [order_id], references: [id])

  @@index([franchise_id, created_at])
  @@index([order_id])
  @@map("wallet_transactions")
}

model User {
  id           Int       @id @default(autoincrement())
  franchise_id Int?
  name         String
  phone        String
  pin_hash     String
  role         UserRole
  is_active    Boolean   @default(true)
  fcm_token    String?
  created_at   DateTime  @default(now())

  franchise Franchise? @relation(fields: [franchise_id], references: [id])
  vendor    Vendor?
  rider     Rider?

  @@unique([franchise_id, phone])
  @@index([franchise_id, role])
  @@map("users")
}

model Vendor {
  id                    Int          @id @default(autoincrement())
  franchise_id          Int
  user_id               Int          @unique
  shop_name             String
  shop_category         ShopCategory @default(HOTEL)
  address               String
  lat                   Decimal      @db.Decimal(10, 7)
  lng                   Decimal      @db.Decimal(10, 7)
  commission_rate       Decimal      @default(10) @db.Decimal(5, 2)
  min_order_value       Decimal      @default(150) @db.Decimal(12, 2)
  upi_id                String?
  is_open               Boolean      @default(true)
  admin_payable_balance Decimal      @default(0) @db.Decimal(12, 2)
  created_at            DateTime     @default(now())
  updated_at            DateTime     @updatedAt

  franchise Franchise @relation(fields: [franchise_id], references: [id])
  user      User      @relation(fields: [user_id], references: [id])
  products  Product[]
  orders    Order[]
  settlement_entries SettlementEntry[]

  @@unique([franchise_id, shop_name])
  @@index([franchise_id, shop_category, is_open])
  @@map("vendors")
}

model Product {
  id             Int      @id @default(autoincrement())
  vendor_id      Int
  name           String
  price          Decimal  @db.Decimal(12, 2)
  image_url      String?
  slot_type      TimeSlot @default(ALL_DAY)
  available_from String?
  available_to   String?
  is_combo       Boolean  @default(false)
  is_available   Boolean  @default(true)
  created_at     DateTime @default(now())
  updated_at     DateTime @updatedAt

  vendor Vendor      @relation(fields: [vendor_id], references: [id])
  order_items OrderItem[]

  @@index([vendor_id, is_available])
  @@index([vendor_id, slot_type, is_available])
  @@map("products")
}

model Rider {
  id                 Int         @id @default(autoincrement())
  franchise_id       Int
  user_id            Int         @unique
  vehicle_type       VehicleType @default(BIKE)
  vehicle_number     String
  license_number     String
  kyc_document_url   String?
  insurance_expiry   DateTime
  emergency_contact  String
  is_online          Boolean     @default(false)
  is_approved        Boolean     @default(false)
  max_active_orders  Int         @default(2)
  cash_in_hand       Decimal     @default(0) @db.Decimal(12, 2)
  max_cash_limit     Decimal     @default(1500) @db.Decimal(12, 2)
  wallet_earnings    Decimal     @default(0) @db.Decimal(12, 2)
  security_deposit   Decimal     @default(0) @db.Decimal(12, 2)
  current_lat        Decimal?    @db.Decimal(10, 7)
  current_lng        Decimal?    @db.Decimal(10, 7)
  last_location_at   DateTime?
  created_at         DateTime    @default(now())
  updated_at         DateTime    @updatedAt

  franchise Franchise @relation(fields: [franchise_id], references: [id])
  user      User      @relation(fields: [user_id], references: [id])
  orders    Order[]
  settlement_entries SettlementEntry[]

  @@index([franchise_id, is_online, is_approved])
  @@map("riders")
}

model Customer {
  id                   Int      @id @default(autoincrement())
  franchise_id         Int
  phone                String
  name                 String?
  turning_point        String?
  lat                  Decimal? @db.Decimal(10, 7)
  lng                  Decimal? @db.Decimal(10, 7)
  gps_accuracy         Decimal? @db.Decimal(8, 2)
  verified_lat         Decimal? @db.Decimal(10, 7)
  verified_lng         Decimal? @db.Decimal(10, 7)
  is_location_verified Boolean  @default(false)
  voice_direction_url  String?
  house_image_url      String?
  rider_delivery_note  String?
  fcm_token            String?
  created_at           DateTime @default(now())
  updated_at            DateTime @updatedAt

  franchise Franchise @relation(fields: [franchise_id], references: [id])

  @@unique([franchise_id, phone])
  @@index([franchise_id, updated_at])
  @@map("customers")
}

model Zone {
  id               Int      @id @default(autoincrement())
  franchise_id     Int
  zone_name        String
  delivery_fee     Decimal  @db.Decimal(12, 2)
  rider_commission Decimal  @db.Decimal(12, 2)
  franchise_profit Decimal  @db.Decimal(12, 2)
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt

  franchise Franchise @relation(fields: [franchise_id], references: [id])
  orders    Order[]

  @@unique([franchise_id, zone_name])
  @@index([franchise_id])
  @@map("zones")
}

model Order {
  id                   Int               @id @default(autoincrement())
  franchise_id         Int
  order_number         String
  order_type           OrderType         @default(HOTEL_DIRECT)
  order_category       OrderCategory     @default(FOOD)
  delivery_handled_by  DeliveryHandledBy @default(PLATFORM_RIDER)
  vendor_id            Int?
  rider_id             Int?
  zone_id              Int?
  customer_phone       String?
  customer_name        String?

  custom_shop_name     String?
  custom_items_text    String?
  rider_paid_at_shop   Boolean           @default(false)
  shop_markup_profit   Decimal           @default(0) @db.Decimal(12, 2)

  bill_image_url       String?
  prescription_img_url String?
  voice_note_url       String?
  location_token       String            @unique
  pickup_address       String?
  pickup_lat           Decimal?          @db.Decimal(10, 7)
  pickup_lng           Decimal?          @db.Decimal(10, 7)
  drop_address         String?
  turning_point        String?
  drop_lat             Decimal?          @db.Decimal(10, 7)
  drop_lng             Decimal?          @db.Decimal(10, 7)

  item_total           Decimal           @default(0) @db.Decimal(12, 2)
  delivery_fee         Decimal           @default(0) @db.Decimal(12, 2)
  rider_tip            Decimal           @default(0) @db.Decimal(12, 2)
  discount_amount      Decimal           @default(0) @db.Decimal(12, 2)
  grand_total          Decimal           @default(0) @db.Decimal(12, 2)
  vendor_commission    Decimal           @default(0) @db.Decimal(12, 2)
  vendor_earning       Decimal           @default(0) @db.Decimal(12, 2)
  rider_earning        Decimal           @default(0) @db.Decimal(12, 2)
  franchise_profit     Decimal           @default(0) @db.Decimal(12, 2)
  super_admin_profit   Decimal           @default(0) @db.Decimal(12, 2)
  amount_to_collect    Decimal           @default(0) @db.Decimal(12, 2)
  vendor_admin_payable Decimal           @default(0) @db.Decimal(12, 2)

  rain_surge_applied   Boolean           @default(false)
  royalty_deducted     Boolean           @default(false)
  settlement_completed Boolean           @default(false)
  is_batched_addon     Boolean           @default(false)

  payment_method       PaymentMethod     @default(COD)
  order_status         OrderStatus       @default(RIDER_REQUESTED)
  created_at           DateTime          @default(now())
  delivered_at         DateTime?

  franchise Franchise @relation(fields: [franchise_id], references: [id])
  vendor    Vendor?   @relation(fields: [vendor_id], references: [id])
  rider     Rider?    @relation(fields: [rider_id], references: [id])
  zone      Zone?     @relation(fields: [zone_id], references: [id])
  items     OrderItem[]
  wallet_transactions WalletTransaction[]
  settlement_entries SettlementEntry[]

  @@unique([franchise_id, order_number])
  @@index([franchise_id, order_status, created_at])
  @@index([franchise_id, rider_id, order_status])
  @@index([franchise_id, vendor_id, order_status])
  @@index([franchise_id, customer_phone])
  @@index([franchise_id, zone_id, order_status])
  @@map("orders")
}

model OrderItem {
  id         Int      @id @default(autoincrement())
  order_id   Int
  product_id Int
  quantity   Int
  unit_price Decimal  @db.Decimal(12, 2)
  line_total Decimal  @db.Decimal(12, 2)
  created_at DateTime @default(now())

  order   Order   @relation(fields: [order_id], references: [id], onDelete: Cascade)
  product Product @relation(fields: [product_id], references: [id])

  @@unique([order_id, product_id])
  @@index([order_id])
  @@index([product_id])
  @@map("order_items")
}

model PushCampaign {
  id           Int      @id @default(autoincrement())
  franchise_id Int
  title        String
  body         String
  cron_time    String   @default("0 16 * * *")
  target_slot  TimeSlot @default(EVENING_SNACKS_3_TO_6)
  is_active    Boolean  @default(true)
  created_at   DateTime @default(now())

  franchise Franchise @relation(fields: [franchise_id], references: [id])

  @@index([franchise_id, is_active])
  @@map("push_campaigns")
}

model SettlementEntry {
  id            Int             @id @default(autoincrement())
  franchise_id  Int
  order_id      Int
  vendor_id     Int?
  rider_id      Int?
  party         SettlementParty
  type          SettlementType
  amount        Decimal         @db.Decimal(12, 2)
  reference_key String          @unique
  description   String
  created_at    DateTime        @default(now())

  franchise Franchise @relation(fields: [franchise_id], references: [id])
  order     Order     @relation(fields: [order_id], references: [id])
  vendor    Vendor?   @relation(fields: [vendor_id], references: [id])
  rider     Rider?    @relation(fields: [rider_id], references: [id])

  @@index([franchise_id, created_at])
  @@index([order_id, type])
  @@index([vendor_id, created_at])
  @@index([rider_id, created_at])
  @@map("settlement_entries")
}
```

---

# 6. Why the Multi-Tenant Unique Constraints Are Required

The following MUST NOT be used:

```prisma
phone String @unique
```

for `User` or `Customer`.

The authoritative constraints are:

```prisma
@@unique([franchise_id, phone])
```

This permits the same phone number to exist in separate franchise tenants while preventing duplicate users/customers inside one franchise.

Every lookup must therefore be:

```ts
where: {
  franchise_id: req.franchise_id,
  phone: normalizedPhone,
}
```

Never perform:

```ts
where: { phone: normalizedPhone }
```

without tenant scope.

For `User`, `franchise_id` can remain nullable for a global `SUPER_ADMIN`. PostgreSQL permits multiple NULL values in a normal unique constraint, so the application must still enforce the intended global-admin policy separately.

---

# 7. OrderItem / Marketplace Checkout

A marketplace cart is not represented by one product field on `Order`.

Each cart line MUST create an `OrderItem`:

```text
Order
 ├── OrderItem -> Product A
 ├── OrderItem -> Product B
 └── OrderItem -> Product C
```

For every item:

```text
line_total = quantity × unit_price
```

The server MUST NOT trust a client-supplied line total.

At checkout:

1. Load products from PostgreSQL.
2. Verify every product belongs to the requested vendor/franchise.
3. Verify availability and time-slot restrictions.
4. Read authoritative product prices.
5. Calculate every line total with the money helper.
6. Sum line totals into `item_total`.
7. Apply the approved `discount_amount`.
8. Add delivery fee.
9. Add any rider tip already selected.
10. Persist the calculated values in the same transaction as `OrderItem` creation.

---

# 8. Money / Rounding Standard

JavaScript `number` arithmetic MUST NOT be used as the source of truth for money.

Use Prisma `Decimal` values and a dedicated helper.

Recommended utility contract:

```ts
import Decimal from "decimal.js";

export function money(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function addMoney(...values: Decimal.Value[]): Decimal {
  return money(values.reduce(
    (sum, value) => sum.plus(value),
    new Decimal(0)
  ));
}

export function multiplyMoney(
  amount: Decimal.Value,
  quantity: Decimal.Value
): Decimal {
  return money(new Decimal(amount).times(quantity));
}

export function percentageMoney(
  amount: Decimal.Value,
  percentage: Decimal.Value
): Decimal {
  return money(
    new Decimal(amount).times(percentage).div(100)
  );
}
```

All persisted financial values MUST be rounded to two decimal places.

Do not calculate:

```ts
0.1 + 0.2
```

as the financial source of truth.

---

# 9. Authoritative Financial Model

The order has four economic destinations:

1. **Vendor**
2. **Rider**
3. **Franchise**
4. **Super Admin**

The financial fields are:

```text
item_total
delivery_fee
discount_amount
rider_tip
vendor_commission
vendor_earning
rider_earning
franchise_profit
super_admin_profit
grand_total
amount_to_collect
vendor_admin_payable
```

### Item amount

```text
item_total = Σ(OrderItem.line_total)
```

### Grand total

```text
grand_total =
    item_total
  + delivery_fee
  + rider_tip
  - discount_amount
```

`grand_total` MUST never be negative.

---

# 10. Vendor Commission

For a marketplace/vendor order:

```text
vendor_commission =
    item_total × vendor.commission_rate / 100
```

rounded to two decimal places.

```text
vendor_earning =
    item_total - vendor_commission
```

For a custom-buy order with no partner vendor, vendor commission is zero.

---

# 11. Normal Four-Way Split

Normal mode uses:

```text
rider_earning =
    zone.rider_commission + rider_tip

franchise_profit =
    zone.franchise_profit
  + shop_markup_profit
  + vendor_commission
  - royalty_per_order

super_admin_profit =
    royalty_per_order
```

The royalty is therefore represented as a separate Super Admin economic share while also being deducted from the franchise's net profit.

All four values MUST be rounded to two decimals.

---

# 12. Correct Launch Promo Math

The launch-promo rule is explicitly:

```text
franchise_profit =
    shop_markup_profit
  + vendor_commission
  - royalty_per_order
```

The previous incorrect implementation that simply forced:

```text
franchise_profit = 0
```

MUST NOT be used.

During launch promo:

```text
rider_earning =
    zone.delivery_fee
  + rider_tip

franchise_profit =
    shop_markup_profit
  + vendor_commission
  - royalty_per_order

super_admin_profit =
    royalty_per_order
```

Thus the launch promo gives 100% of the delivery fee to the rider while preserving vendor commission and shop markup economics.

If the resulting franchise profit is negative, it remains negative as a real accounting value; it MUST NOT silently be converted to zero.

---

# 13. Rain Surge

At pickup:

1. Load the franchise row inside the transaction.
2. If `rain_surge_fee > 0` and `rain_surge_applied = false`, add the surge exactly once.
3. Set `rain_surge_applied = true`.
4. Recalculate:
   - `rider_tip`
   - `rider_earning`
   - `grand_total`
   - `amount_to_collect`
5. If pickup is retried, do not add the surge again.

Conceptually:

```text
rider_tip += rain_surge_fee
rider_earning += rain_surge_fee
grand_total += rain_surge_fee
amount_to_collect += rain_surge_fee
```

The exact financial event MUST also be written to `SettlementEntry` using an idempotent `reference_key`.

---

# 14. Payment Methods & amount_to_collect

The platform supports exactly:

- `COD`
- `PREPAID_AT_HOTEL`
- `UPI_TO_ADMIN`

## 14.1 COD

The customer pays the rider the entire order amount.

```text
amount_to_collect = grand_total
```

At successful delivery:

```text
rider.cash_in_hand += amount_to_collect
```

For a normal partner-vendor order, the vendor's platform payable is:

```text
vendor_admin_payable = vendor_earning
```

The commission retained by the platform is therefore not incorrectly recorded as money owed to the vendor.

## 14.2 PREPAID_AT_HOTEL

The customer has already paid the item amount directly to the hotel/vendor.

The rider collects only unpaid delivery-side charges:

```text
amount_to_collect =
    delivery_fee
  + rider_tip
  - delivery_side_discount
```

For the normal implementation where no delivery-side discount exists:

```text
amount_to_collect = delivery_fee + rider_tip
```

The rider MUST NOT collect the item amount again.

## 14.3 UPI_TO_ADMIN

The customer pays the platform/admin electronically.

```text
amount_to_collect = 0
```

The rider MUST NOT be instructed to collect the prepaid amount in cash.

The financial record still stores the full `grand_total` for reconciliation.

---

# 15. Rider Cash-In-Hand Safety

`cash_in_hand` is a real operational liability/risk metric.

Before rider acceptance:

```text
if rider.cash_in_hand >= rider.max_cash_limit:
    reject
```

Use `>=`, not only `>`.

At delivery:

```text
rider.cash_in_hand += amount_to_collect
```

For custom-buy where the rider paid the shop personally:

```text
rider.cash_in_hand += grand_total - item_total
```

provided that:

```text
rider_paid_at_shop = true
```

This prevents the rider's own advance payment from being incorrectly counted as customer cash collected.

---

# 16. Vendor Admin Payable Ledger

For a marketplace partner order:

```text
vendor_admin_payable = vendor_earning
```

not the raw `item_total`.

At settlement:

```text
vendor.admin_payable_balance += vendor_admin_payable
```

Create a corresponding `SettlementEntry` with:

```text
party = VENDOR_PAYABLE
type = VENDOR_PAYABLE
amount = vendor_admin_payable
```

Use a deterministic reference key such as:

```text
order:{order_id}:vendor-payable
```

so a retried delivery request cannot duplicate the payable.

---

# 17. Rider Acceptance — PostgreSQL Row-Level Lock

Endpoint:

`POST /api/v1/orders/:id/accept`

The acceptance operation MUST run inside:

```ts
await prisma.$transaction(async (tx) => {
  // ...
});
```

The order MUST be locked with PostgreSQL:

```sql
SELECT *
FROM "orders"
WHERE id = $1
  AND franchise_id = $2
  AND order_status = 'RIDER_REQUESTED'
FOR UPDATE
```

Equivalent Prisma raw query:

```ts
const rows = await tx.$queryRaw<
  Array<{ id: number; order_status: string }>
>`
  SELECT id, order_status
  FROM "orders"
  WHERE id = ${orderId}
    AND franchise_id = ${franchiseId}
    AND order_status = 'RIDER_REQUESTED'
  FOR UPDATE
`;
```

If no row is returned, another rider already accepted the order or the order is no longer available.

The transaction MUST then:

1. Lock/load the rider.
2. Verify rider belongs to `req.franchise_id`.
3. Verify rider is approved and online.
4. Verify `cash_in_hand < max_cash_limit`.
5. Count active orders:
   - `RIDER_ASSIGNED`
   - `PICKED_UP`
   - `LOCATION_SHARED`
6. Verify active count `< max_active_orders`.
7. Assign the rider.
8. Set `order_status = RIDER_ASSIGNED`.
9. Commit.

This is required to prevent two riders from simultaneously accepting the same order.

---

# 18. Quick Vendor Call

Endpoint:

`POST /api/v1/orders/quick-call`

### Step 1 — Royalty wallet gate

Allow order creation only when:

```text
franchise.wallet_balance > franchise.min_balance_limit
```

Otherwise:

```text
403
"Franchise wallet balance low. Please recharge."
```

### Step 2 — Create order

Create:

```text
order_status = RIDER_REQUESTED
```

and an opaque unique `location_token`.

### Step 3 — Rider dispatch

Emit:

```text
new_rider_request
```

to eligible online riders with zero active orders.

For riders with one active order:

```text
active_orders_count < max_active_orders
```

and matching vendor or destination zone, emit:

```text
addon_order_alert
```

Payload:

```json
{
  "order_id": 123,
  "message": "🔥 Add-on Order on your route!"
}
```

---

# 19. Rider Pickup

Endpoint:

`PUT /api/v1/orders/:id/rider-pickup`

Request contains:

- `bill_image_url`
- `customer_phone`
- `item_total` for non-marketplace/custom flows
- `zone_id`
- `payment_method`

For marketplace orders, item total MUST be calculated from `OrderItem` records rather than trusted from the request.

### Customer lookup

Always scope by:

```text
franchise_id + normalized_phone
```

If a customer exists and:

```text
is_location_verified = true
```

copy:

```text
verified_lat -> order.drop_lat
verified_lng -> order.drop_lng
```

The response may include:

- turning point
- voice direction URL
- house image URL
- rider delivery note

only for the authorized rider handling that order.

---

# 20. Rider Tip — Magic Link

Endpoint:

`POST /api/v1/public/drop/:token/tip`

Allowed tip values:

```text
10
20
30
```

Reject all other values.

For an accepted tip:

```text
rider_tip += tip
rider_earning += tip
grand_total += tip
amount_to_collect += tip
```

The tip is 100% rider money.

The endpoint MUST be idempotent. A retry caused by a network timeout MUST NOT apply the same customer action twice.

Recommended implementation:

- create an idempotency key from the request;
- persist it in a unique financial/settlement record;
- use a transaction;
- update the order only if the settlement reference does not already exist.

Example settlement reference:

```text
order:{order_id}:tip:{client_action_id}
```

---

# 21. Rural Magic Link GPS Accuracy

Endpoint:

`POST /api/v1/public/drop/:token/voice-and-pin`

Frontend:

```js
navigator.geolocation.getCurrentPosition(
  onSuccess,
  onError,
  {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000
  }
);
```

Read:

```text
coords.latitude
coords.longitude
coords.accuracy
```

### Accuracy rule

If:

```text
gps_accuracy > 50
```

and no voice recording is attached, return a warning rather than silently treating the point as an accurate gate location.

Exact Malayalam warning:

> ലൊക്കേഷൻ കൃത്യത കുറവാണ് (Indoor GPS). ദയവായി മുറ്റത്തോ വരാന്തയിലോ ഇറങ്ങി നിന്ന് അമർത്തുക, അല്ലെങ്കിൽ താഴെ കാണുന്ന മൈക്കിൽ വഴി റെക്കോർഡ് ചെയ്യുക.

The request MAY proceed with a voice note because the voice route provides an additional rural-navigation aid.

Save:

- `lat`
- `lng`
- `gps_accuracy`
- `turning_point`
- `voice_direction_url`

to the order and the franchise-scoped customer record.

---

# 22. Delivery Completion

Endpoint:

`POST /api/v1/orders/:id/deliver`

The entire operation MUST be one PostgreSQL transaction.

Input:

```json
{
  "rider_lat": 11.0000000,
  "rider_lng": 75.0000000,
  "rider_delivery_note": "Blue gate near mosque",
  "gate_photo_url": "..."
}
```

The server MUST verify:

1. authenticated rider owns the order;
2. order belongs to the rider's franchise;
3. order is not already delivered;
4. order is in a deliverable state.

### Gate verification

Update the franchise-scoped customer:

```text
verified_lat = rider_lat
verified_lng = rider_lng
is_location_verified = true
```

Also save:

- rider delivery note
- house image URL when supplied

---

# 23. Atomic Delivery Settlement

Inside one transaction:

1. Lock order.
2. Lock rider.
3. Lock vendor when applicable.
4. Lock franchise.
5. Verify `settlement_completed = false`.
6. Set `delivered_at`.
7. Set `order_status = DELIVERED`.
8. Apply customer gate verification.
9. Apply cash collection.
10. Apply vendor payable.
11. Apply rider earnings.
12. Apply milestone bonus if earned.
13. Deduct royalty exactly once.
14. Write all settlement entries.
15. Mark `settlement_completed = true`.
16. Commit.

A retry after commit MUST return the already-settled state rather than applying money a second time.

---

# 24. Royalty Deduction

On successful delivery:

```text
super_admin_profit = franchise.royalty_per_order
```

If:

```text
royalty_deducted = false
```

then:

```text
franchise.wallet_balance -= royalty_per_order
```

and create:

```text
WalletTransaction:
  type = DEBIT
  amount = royalty_per_order
  order_id = order.id
```

Then set:

```text
royalty_deducted = true
```

The unique settlement reference:

```text
order:{order_id}:royalty
```

prevents duplicate royalty entries.

---

# 25. Rider Earnings & Daily Milestone

After the order is marked delivered:

```text
rider.wallet_earnings += order.rider_earning
```

Count today's delivered orders for that rider using the franchise/rider scope and Asia/Kolkata day boundary.

When:

```text
delivered_today_count == franchise.daily_milestone_target
```

add:

```text
franchise.daily_milestone_bonus
```

to `rider.wallet_earnings`.

Create a settlement entry:

```text
party = RIDER_EARNING
type = MILESTONE_BONUS
```

Reference:

```text
rider:{rider_id}:milestone:{YYYY-MM-DD}:{target}
```

Emit:

```text
milestone_achieved
```

Payload:

```json
{
  "bonus": 50,
  "target": 20
}
```

The milestone bonus MUST be issued only once for that rider/date/target.

---

# 26. 4 PM Chayakadi Dynamic Marketplace

Between:

```text
15:00
18:00
```

Asia/Kolkata time:

1. prioritize `EVENING_SNACKS_3_TO_6`;
2. pin Chayakadi/Coolbar combos above normal marketplace products;
3. use the snack minimum order value of ₹80;
4. show categories:
   - Food
   - 4 PM Snacks
   - Grocery
   - Fish & Meat
   - Medical
   - Buy Anything

The UI label:

`☕ 4 PM Chayakadi & Coolbar Combos`

The backend MUST calculate the time window using a timezone-aware date library rather than server-local time.

---

# 27. Exact node-cron Scheduler

File:

`src/cron/pushScheduler.js`

The process MUST use Asia/Kolkata.

Example:

```js
import cron from "node-cron";
import { getMessaging } from "firebase-admin/messaging";
import { prisma } from "../lib/prisma.js";

export function startPushScheduler() {
  cron.schedule(
    "0 16 * * *",
    async () => {
      const campaigns = await prisma.pushCampaign.findMany({
        where: {
          is_active: true,
          cron_time: "0 16 * * *",
        },
        include: {
          franchise: {
            include: {
              customers: {
                where: {
                  fcm_token: { not: null },
                },
                select: {
                  fcm_token: true,
                },
              },
            },
          },
        },
      });

      for (const campaign of campaigns) {
        const tokens = campaign.franchise.customers
          .map((customer) => customer.fcm_token)
          .filter(Boolean);

        if (tokens.length === 0) continue;

        for (let i = 0; i < tokens.length; i += 500) {
          const batch = tokens.slice(i, i + 500);

          await getMessaging().sendEachForMulticast({
            tokens: batch,
            notification: {
              title: campaign.title,
              body: campaign.body,
            },
            data: {
              target_slot: campaign.target_slot,
              franchise_slug: campaign.franchise.slug,
            },
          });
        }
      }
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
}
```

The scheduler MUST be started exactly once by the backend process.

For multi-instance production deployment, use a distributed scheduler/leader mechanism or a database-backed job lock so multiple application replicas do not send duplicate campaigns.

---

# 28. Socket.io Live Tracking Contract

### Rider

During an active delivery:

```js
navigator.wakeLock.request("screen");
```

and:

```js
navigator.geolocation.watchPosition(...)
```

The rider client emits:

```text
rider_location_move
```

every 5 seconds.

Payload:

```json
{
  "order_id": 123,
  "lat": 11.0000000,
  "lng": 75.0000000,
  "accuracy": 8.5,
  "timestamp": 1730000000000
}
```

The server MUST verify:

- authenticated rider;
- rider owns the order;
- order belongs to the same franchise;
- order is in an active delivery state.

The server then updates:

```text
rider.current_lat
rider.current_lng
rider.last_location_at
```

and emits to the authorized customer tracking room:

```text
live_bike_position
```

### Customer

The Magic Link page:

`/drop/:token`

subscribes to the order's tracking room and animates the rider marker on a Leaflet/OpenStreetMap map.

The customer MUST NOT receive:

- rider phone number;
- rider KYC data;
- other orders;
- other customer data;
- franchise internal financial information.

---

# 29. Socket Room Design

Recommended room names:

```text
franchise:{franchise_id}
order:{order_id}
rider:{rider_id}
```

A rider joins an order room only after authentication and authorization.

A public customer tracking session joins an order room only after the server resolves the opaque `location_token`.

Never allow a client to choose an arbitrary room name without server-side authorization.

---

# 30. Tenant Safety Rules for Socket.io

Every socket event must carry server-derived tenant context.

Do not trust:

```json
{
  "franchise_id": 99
}
```

from the client.

The server determines the franchise from:

- authenticated user;
- rider record;
- order record;
- Magic Link token.

For `rider_location_move`, the server derives the franchise from the rider/order relationship.

---

# 31. API Contract Summary

| Endpoint | Purpose | Transaction |
|---|---|---|
| `POST /api/v1/orders/quick-call` | Create rider request | Yes |
| `POST /api/v1/orders/:id/accept` | Atomic rider acceptance | Yes + `FOR UPDATE` |
| `PUT /api/v1/orders/:id/rider-pickup` | Bill/customer/payment/pickup | Yes |
| `POST /api/v1/public/drop/:token/voice-and-pin` | Rural GPS/voice route | Yes |
| `POST /api/v1/public/drop/:token/tip` | Customer tip | Yes |
| `POST /api/v1/orders/:id/deliver` | Delivery + settlement | Yes |
| `GET /api/v1/marketplace/feed` | Marketplace feed | Read |
| `Socket: rider_location_move` | Rider GPS | Authorized event |
| `Socket: live_bike_position` | Customer live location | Server emitted |

---

# 32. Order Lifecycle

```text
RIDER_REQUESTED
      |
      v
RIDER_ASSIGNED
      |
      v
PICKED_UP
      |
      v
LOCATION_SHARED
      |
      v
DELIVERED
```

Cancellation may occur from eligible pre-delivery states:

```text
RIDER_REQUESTED
RIDER_ASSIGNED
PICKED_UP
LOCATION_SHARED
```

A delivered order MUST NOT be transitioned back to an active state.

---

# 33. Financial Event Idempotency

Every money-changing operation MUST have a deterministic unique reference.

Examples:

```text
order:{id}:royalty
order:{id}:vendor-payable
order:{id}:rider-earning
order:{id}:cash-collection
order:{id}:rain-surge
order:{id}:tip:{client_action_id}
rider:{id}:milestone:{date}:{target}
```

The `SettlementEntry.reference_key` unique constraint is a second line of defense against duplicate financial writes.

---

# 34. Required Transaction Boundaries

### Pickup transaction

Must atomically update:

- order item totals;
- payment method;
- customer lookup data;
- financial split;
- rain surge;
- `rain_surge_applied`.

### Tip transaction

Must atomically update:

- `rider_tip`;
- `rider_earning`;
- `grand_total`;
- `amount_to_collect`;
- tip settlement entry.

### Delivery transaction

Must atomically update:

- order status;
- customer verified location;
- rider cash;
- vendor payable;
- rider earnings;
- milestone bonus;
- franchise royalty wallet;
- settlement entries;
- `royalty_deducted`;
- `settlement_completed`.

---

# 35. PostgreSQL Isolation & Locking Policy

Default Prisma transactions are acceptable for ordinary reads, but financial/race-sensitive operations MUST explicitly lock the rows they mutate.

Required lock order for delivery settlement:

```text
Order
  -> Rider
  -> Vendor (if applicable)
  -> Franchise
```

Use the same lock order across all settlement paths to reduce deadlock risk.

The rider acceptance endpoint MUST use:

```sql
FOR UPDATE
```

on the order before assigning it.

---

# 36. Indexing Strategy

Required indexes include:

- `users(franchise_id, role)`
- `customers(franchise_id, updated_at)`
- `vendors(franchise_id, shop_category, is_open)`
- `products(vendor_id, is_available)`
- `orders(franchise_id, order_status, created_at)`
- `orders(franchise_id, rider_id, order_status)`
- `orders(franchise_id, vendor_id, order_status)`
- `orders(franchise_id, customer_phone)`
- `orders(franchise_id, zone_id, order_status)`
- `order_items(order_id)`
- `settlement_entries(order_id, type)`
- `settlement_entries(rider_id, created_at)`
- `settlement_entries(vendor_id, created_at)`

These indexes are necessary for rider dispatch, marketplace queries, customer lookup, daily milestone counts, and settlement reconciliation.

---

# 37. Security Requirements

1. Normalize phone numbers before storage.
2. Hash PINs; never store plaintext PINs.
3. Validate every request body.
4. Validate uploaded file type and size.
5. Store media outside the application server where possible.
6. Never expose raw KYC documents through public URLs.
7. Rate-limit public Magic Link endpoints.
8. Rate-limit OTP/login endpoints if implemented.
9. Do not expose internal Prisma errors to clients.
10. Use structured audit logs for financial mutations.
11. Require HTTPS in production.
12. Validate Socket.io authentication during connection and event handling.
13. Never accept a client-provided `franchise_id` as the authority for tenancy.

---

# 38. Rural Navigation Data Policy

The system stores two classes of customer location:

### Raw customer GPS

Captured from the customer's browser:

```text
lat
lng
gps_accuracy
```

### Verified gate GPS

Captured by the rider physically at delivery:

```text
verified_lat
verified_lng
is_location_verified = true
```

Verified gate GPS is the preferred future navigation target.

The rider's delivery note and voice route note are complementary navigation aids, particularly when the GPS point is affected by indoor signal degradation.

---

# 39. GPS Accuracy UX

The frontend MUST visually distinguish:

- good GPS accuracy: `<= 50m`
- weak GPS accuracy: `> 50m`

For weak accuracy:

```text
ലൊക്കേഷൻ കൃത്യത കുറവാണ് (Indoor GPS). ദയവായി മുറ്റത്തോ വരാന്തയിലോ ഇറങ്ങി നിന്ന് അമർത്തുക, അല്ലെങ്കിൽ താഴെ കാണുന്ന മൈക്കിൽ വഴി റെക്കോർഡ് ചെയ്യുക.
```

Do not reject every inaccurate GPS point. If the customer provides a voice route note, the platform may save the point together with the warning state.

---

# 40. Marketplace Feed Rules

The feed must be franchise scoped.

At normal hours:

```text
standard category ordering
```

At 15:00–18:00 IST:

```text
4 PM Chayakadi & Coolbar Combos
```

is pinned first.

The backend, not only the frontend, must enforce:

- product availability;
- vendor availability;
- time slot;
- franchise ownership;
- minimum order rules.

---

# 41. Production Reconciliation

A finance/admin dashboard MUST be able to reconcile:

```text
Order grand total
      |
      +-- customer payment / amount to collect
      |
      +-- vendor payable
      |
      +-- rider earning
      |
      +-- franchise profit
      |
      +-- super admin royalty
```

Every discrepancy must be traceable through:

- `Order`
- `OrderItem`
- `SettlementEntry`
- `WalletTransaction`

Do not rely only on mutable aggregate balances for historical accounting.

---

# 42. Required Test Cases

## Tenant uniqueness

- Same phone + same franchise -> reject.
- Same phone + different franchise -> allow.
- Customer lookup must never cross franchise.
- User authentication must never resolve a user from another franchise.

## Marketplace

- One order with one item.
- One order with multiple products.
- Same product repeated in cart -> merge into one `OrderItem`.
- Server recalculates prices.
- Product from another franchise/vendor -> reject.

## Launch promo

Given:

```text
delivery_fee = 50
rider_commission = 25
zone.franchise_profit = 20
shop_markup_profit = 10
vendor_commission = 15
royalty = 3
tip = 20
```

Expected:

```text
rider_earning = 50 + 20 = 70
franchise_profit = 10 + 15 - 3 = 22
super_admin_profit = 3
```

## Normal mode

Expected:

```text
rider_earning = rider_commission + tip
franchise_profit =
    zone.franchise_profit
  + shop_markup_profit
  + vendor_commission
  - royalty
super_admin_profit = royalty
```

## Rain surge

Calling pickup twice MUST add the surge once.

## Tip

Calling `+₹20` once:

```text
rider_tip += 20
rider_earning += 20
grand_total += 20
amount_to_collect += 20
```

Calling the same client action again MUST NOT change values.

## Cash

COD:

```text
amount_to_collect = grand_total
cash_in_hand += grand_total
```

Prepaid at hotel:

```text
amount_to_collect = delivery_fee + rider_tip
```

UPI to admin:

```text
amount_to_collect = 0
```

## Rider race

Two riders accepting the same order concurrently:

- exactly one succeeds;
- exactly one receives `RIDER_ASSIGNED`;
- the other receives an unavailable/conflict response.

## Delivery retry

Calling delivery twice:

- only one settlement;
- only one royalty deduction;
- only one vendor payable;
- only one rider earning;
- only one cash collection.

## GPS

- accuracy 25m -> normal save.
- accuracy 75m + no voice -> Malayalam warning.
- accuracy 75m + voice -> save GPS + voice route.

## Milestone

At exactly the 20th delivered order:

- bonus is granted once;
- Socket event is emitted;
- repeated delivery request does not grant another bonus.

---

# 43. Deployment Requirements

Production services:

```text
Node.js API
PostgreSQL
Socket.io
Firebase Admin
Cloudflare R2/S3
Nginx or equivalent reverse proxy
```

Recommended production process model:

```text
Internet
   |
   v
Nginx / TLS
   |
   v
Node.js API
   |
   +--> PostgreSQL
   +--> Redis (optional for Socket scaling / distributed locks)
   +--> Firebase FCM
   +--> R2 object storage
```

If multiple Node.js replicas are used, Socket.io MUST use a compatible adapter such as Redis so events are delivered across instances.

---

# 44. Migration Requirements From the Previous Schema

The following changes are mandatory:

1. Remove `@unique` from `User.phone`.
2. Add:

```prisma
@@unique([franchise_id, phone])
```

3. Remove `@unique` from `Customer.phone`.
4. Add:

```prisma
@@unique([franchise_id, phone])
```

5. Add `OrderItem`.
6. Add `vendor_commission`.
7. Add `amount_to_collect`.
8. Add `vendor_admin_payable`.
9. Add `rain_surge_applied`.
10. Add `royalty_deducted`.
11. Add `settlement_completed`.
12. Add `SettlementEntry`.
13. Convert money fields to PostgreSQL `NUMERIC(12,2)` through Prisma `Decimal`.
14. Add tenant-aware order number uniqueness.
15. Add required operational indexes.

Before applying the migration in production:

```bash
npx prisma migrate dev --name production_financial_multitenant_fix
npx prisma generate
```

After review, deploy the generated migration with:

```bash
npx prisma migrate deploy
```

A production database backup MUST be taken before the migration.

---

# 45. Final Architectural Invariants

The following statements MUST always remain true:

```text
1. A phone number is unique only within its franchise.
2. Every order belongs to exactly one franchise.
3. Every marketplace product line is represented by OrderItem.
4. Every money-changing event is transactional.
5. Every money-changing event has an idempotent reference.
6. Rain surge can be applied only once per order.
7. A tip increases rider_tip, rider_earning, grand_total and amount_to_collect together.
8. Launch promo franchise profit =
   shop_markup_profit + vendor_commission - royalty_per_order.
9. COD cash-in-hand increase equals amount_to_collect.
10. Prepaid-at-hotel does not make the rider collect the item amount.
11. UPI-to-admin makes rider amount_to_collect zero.
12. Vendor payable is vendor_earning, not raw item_total.
13. Royalty is deducted once per delivered order.
14. Rider acceptance uses PostgreSQL FOR UPDATE.
15. Delivery settlement is atomic.
16. Verified gate GPS is franchise-scoped and preferred for future delivery.
17. GPS accuracy above 50m triggers the Malayalam indoor-GPS guidance when no voice route is supplied.
18. Rider live tracking is authorized by rider/order ownership.
19. Customer Magic Links cannot access another order or franchise.
20. All financial calculations use two-decimal safe money arithmetic.
```

This document is the authoritative production specification for the corrected multi-franchise hyperlocal delivery architecture.
