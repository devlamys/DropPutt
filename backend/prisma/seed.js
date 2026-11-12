// Seed: kizhissery franchise, Super Admin, Franchise Admin, two vendors,
// two riders, three zones and the 4 PM push campaign.
//
// Idempotent — safe to run repeatedly (`npx prisma db seed`).
// Phones, coordinates, vehicle and licence numbers are development
// placeholders; replace them with real values before going live.

import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const FRANCHISE_SLUG = "kizhissery";

function resolveSeedPin() {
  const pin = process.env.SEED_DEFAULT_PIN;
  if (pin) return pin;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SEED_DEFAULT_PIN must be set when NODE_ENV=production");
  }
  return "1234";
}

/** Digits only, last 10 — Indian mobile numbers without country code. */
function normalizePhone(phone) {
  return String(phone).replace(/\D/g, "").slice(-10);
}

async function upsertFranchiseUser(franchise_id, { name, phone, role }, pin_hash) {
  const normalized = normalizePhone(phone);
  return prisma.user.upsert({
    where: { franchise_id_phone: { franchise_id, phone: normalized } },
    update: { name, role, is_active: true },
    create: { franchise_id, name, phone: normalized, role, pin_hash },
  });
}

// franchise_id is NULL for the global Super Admin, and PostgreSQL does not
// treat NULLs as equal in a unique constraint — so no upsert; look it up.
async function upsertSuperAdmin({ name, phone }, pin_hash) {
  const normalized = normalizePhone(phone);
  const existing = await prisma.user.findFirst({
    where: { franchise_id: null, role: "SUPER_ADMIN", phone: normalized },
  });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { name, is_active: true },
    });
  }
  return prisma.user.create({
    data: {
      franchise_id: null,
      name,
      phone: normalized,
      role: "SUPER_ADMIN",
      pin_hash,
    },
  });
}

async function main() {
  const pin_hash = await argon2.hash(resolveSeedPin());

  // ─── Franchise ────────────────────────────────────────────────────────────
  const franchise = await prisma.franchise.upsert({
    where: { slug: FRANCHISE_SLUG },
    update: { name: "Kizhissery", is_active: true },
    create: { name: "Kizhissery", slug: FRANCHISE_SLUG },
  });
  const franchise_id = franchise.id;

  // ─── Admins ───────────────────────────────────────────────────────────────
  const superAdmin = await upsertSuperAdmin(
    {
      name: "Super Admin",
      phone: process.env.SEED_SUPER_ADMIN_PHONE || "9000000001",
    },
    pin_hash
  );

  const franchiseAdmin = await upsertFranchiseUser(
    franchise_id,
    { name: "Kizhissery Franchise Admin", phone: "9000000002", role: "FRANCHISE_ADMIN" },
    pin_hash
  );

  // ─── Vendors ──────────────────────────────────────────────────────────────
  const vendors = [
    {
      user: { name: "Farsa Hotel", phone: "9000000011", role: "VENDOR" },
      shop_name: "Farsa Hotel",
      shop_category: "HOTEL",
      address: "Main Road, Kizhissery, Malappuram, Kerala",
      lat: "11.1786000",
      lng: "75.9982000",
      commission_rate: "10.00",
      min_order_value: "150.00",
    },
    {
      user: { name: "Kizhissery Bakes", phone: "9000000012", role: "VENDOR" },
      shop_name: "Kizhissery Bakes",
      shop_category: "BAKERY_COOLBAR",
      address: "Junction, Kizhissery, Malappuram, Kerala",
      lat: "11.1792000",
      lng: "75.9990000",
      commission_rate: "10.00",
      min_order_value: "80.00", // 4 PM snack minimum (SPEC §26)
    },
  ];

  for (const { user, ...shop } of vendors) {
    const vendorUser = await upsertFranchiseUser(franchise_id, user, pin_hash);
    await prisma.vendor.upsert({
      where: { user_id: vendorUser.id },
      update: { ...shop, franchise_id },
      create: { ...shop, franchise_id, user_id: vendorUser.id },
    });
  }

  // ─── Riders ───────────────────────────────────────────────────────────────
  const insurance_expiry = new Date("2027-12-31T00:00:00+05:30");
  const riders = [
    {
      user: { name: "Ameen", phone: "9000000021", role: "RIDER" },
      vehicle_type: "BIKE",
      vehicle_number: "KL-10-AA-0001",
      license_number: "KL10-SEED-0001",
      emergency_contact: "9000000031",
    },
    {
      user: { name: "Shafeeq", phone: "9000000022", role: "RIDER" },
      vehicle_type: "SCOOTER",
      vehicle_number: "KL-10-AA-0002",
      license_number: "KL10-SEED-0002",
      emergency_contact: "9000000032",
    },
  ];

  for (const { user, ...profile } of riders) {
    const riderUser = await upsertFranchiseUser(franchise_id, user, pin_hash);
    const data = { ...profile, franchise_id, insurance_expiry, is_approved: true };
    await prisma.rider.upsert({
      where: { user_id: riderUser.id },
      update: data,
      create: { ...data, user_id: riderUser.id },
    });
  }

  // ─── Zones (delivery_fee = rider_commission + franchise_profit) ───────────
  const zones = [
    { zone_name: "Zone 1 — Kizhissery Town (0–2 km)", delivery_fee: "30.00", rider_commission: "20.00", franchise_profit: "10.00" },
    { zone_name: "Zone 2 — Nearby (2–5 km)", delivery_fee: "40.00", rider_commission: "27.00", franchise_profit: "13.00" },
    { zone_name: "Zone 3 — Outer (5–8 km)", delivery_fee: "50.00", rider_commission: "35.00", franchise_profit: "15.00" },
  ];

  for (const zone of zones) {
    await prisma.zone.upsert({
      where: {
        franchise_id_zone_name: { franchise_id, zone_name: zone.zone_name },
      },
      update: zone,
      create: { ...zone, franchise_id },
    });
  }

  // ─── 4 PM push campaign (no natural unique key — match, then write) ───────
  const campaign = {
    title: "☕ 4 PM Chayakadi & Coolbar Combos",
    body: "ചായ സമയം ആയി! ചൂടൻ പലഹാരങ്ങളും കൂൾബാർ കോംബോകളും ഇപ്പോൾ ഓർഡർ ചെയ്യൂ.",
    cron_time: "0 16 * * *",
    target_slot: "EVENING_SNACKS_3_TO_6",
    is_active: true,
  };
  const existingCampaign = await prisma.pushCampaign.findFirst({
    where: {
      franchise_id,
      cron_time: campaign.cron_time,
      target_slot: campaign.target_slot,
    },
  });
  if (existingCampaign) {
    await prisma.pushCampaign.update({
      where: { id: existingCampaign.id },
      data: campaign,
    });
  } else {
    await prisma.pushCampaign.create({ data: { ...campaign, franchise_id } });
  }

  console.log("Seed complete:", {
    franchise: `${franchise.slug} (id ${franchise.id})`,
    super_admin_id: superAdmin.id,
    franchise_admin_id: franchiseAdmin.id,
    vendors: vendors.map((v) => v.shop_name),
    riders: riders.map((r) => r.user.name),
    zones: zones.length,
    push_campaign: campaign.cron_time,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
