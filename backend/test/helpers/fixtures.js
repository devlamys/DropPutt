import argon2 from "argon2";
import { signAccessToken } from "../../src/middleware/auth.js";
import { prisma } from "./app.js";

export const PIN = "4321";
let pinHash;
const hash = async () => (pinHash ??= await argon2.hash(PIN));

let phoneSeq = 0;
/** Unique valid mobile numbers: 9xxxxxxxxx. */
export const nextPhone = () => String(9_000_000_000 + ++phoneSeq * 7).slice(0, 10);

async function makeUser(franchise_id, role, name, phone = nextPhone()) {
  return prisma.user.create({
    data: { franchise_id, role, name, phone, pin_hash: await hash() },
  });
}

export const tokenFor = (user) => signAccessToken(user, null);

/**
 * One franchise with an admin, a vendor (with products), two online riders,
 * and three zones. Returns the rows plus ready-made access tokens.
 */
export async function makeWorld({ slug = "tf", name = "Test Franchise", franchise = {} } = {}) {
  const f = await prisma.franchise.create({ data: { name, slug, ...franchise } });
  const zones = [];
  for (const [zone_name, delivery_fee, rider_commission, franchise_profit] of [
    ["Zone 1", 30, 20, 10],
    ["Zone 2", 40, 27, 13],
    ["Zone 3", 50, 35, 15],
  ]) {
    zones.push(
      await prisma.zone.create({
        data: { franchise_id: f.id, zone_name, delivery_fee, rider_commission, franchise_profit },
      })
    );
  }

  const admin = await makeUser(f.id, "FRANCHISE_ADMIN", "Admin");

  const vendorUser = await makeUser(f.id, "VENDOR", "Hotel owner");
  const vendor = await prisma.vendor.create({
    data: {
      franchise_id: f.id,
      user_id: vendorUser.id,
      shop_name: `${name} Hotel`,
      address: "Main Road",
      lat: "11.0000000",
      lng: "76.0000000",
      commission_rate: 10,
      min_order_value: 100,
    },
  });
  const product = (data) => prisma.product.create({ data: { vendor_id: vendor.id, ...data } });
  const products = {
    biryani: await product({ name: "Biryani", price: 100 }),
    meals: await product({ name: "Meals", price: 60 }),
    lunchOnly: await product({ name: "Lunch special", price: 90, slot_type: "LUNCH_ONLY" }),
    unavailable: await product({ name: "Sold out", price: 50, is_available: false }),
  };

  const riders = [];
  for (let i = 0; i < 2; i += 1) {
    const user = await makeUser(f.id, "RIDER", `Rider ${i + 1}`);
    const rider = await prisma.rider.create({
      data: {
        franchise_id: f.id,
        user_id: user.id,
        vehicle_number: `KL-10-${i}`,
        license_number: `LIC-${slug}-${i}`,
        insurance_expiry: new Date("2030-01-01"),
        emergency_contact: "9000000000",
        is_online: true,
        is_approved: true,
      },
    });
    riders.push({ user, rider, token: tokenFor(user) });
  }

  return {
    franchise: f,
    slug,
    zones,
    admin,
    adminToken: tokenFor(admin),
    vendorUser,
    vendor,
    vendorToken: tokenFor(vendorUser),
    products,
    riders,
  };
}

/** A second, unrelated franchise for tenant-isolation tests. */
export const makeOtherWorld = () => makeWorld({ slug: "other", name: "Other Franchise" });
