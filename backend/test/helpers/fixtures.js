import argon2 from "argon2";
import { signAccessToken } from "../../src/middleware/auth.js";
import { prisma } from "./app.js";

export const PIN = "4321";
let pinHash;
const hash = async () => (pinHash ??= await argon2.hash(PIN));

let phoneSeq = 0;
/** Unique valid mobile numbers: 9xxxxxxxxx. */
export const nextPhone = () => String(9_000_000_000 + ++phoneSeq * 7).slice(0, 10);

export async function makeUser(franchise_id, role, name, phone = nextPhone()) {
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
  const f = await prisma.franchise.create({ data: { name, slug, max_delivery_km: 8, ...franchise } });
  const zones = [];
  for (const [zone_name, delivery_fee, max_km] of [
    ["Zone 1", 30, 2],
    ["Zone 2", 40, 5],
    ["Zone 3", 50, 8],
  ]) {
    zones.push(
      await prisma.zone.create({
        data: { franchise_id: f.id, zone_name, delivery_fee, max_km },
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
      commission_free_until: new Date(Date.now() + 180 * 86_400_000), // Call Rider Now trial (§10.1)
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

/**
 * A delivery pin about `roadKm` km (by the no-router estimate, which stretches a straight
 * line by 1.3) from the test vendor, who is at 11.0, 76.0. `pinAt(1)` is in Zone 1 (up to 2 km),
 * `pinAt(3)` in Zone 2 (up to 5), `pinAt(7)` in Zone 3 (up to 8), `pinAt(9)` is out of range.
 */
export const pinAt = (roadKm) => ({ drop_lat: Number((11.0 + roadKm / 1.3 / 111.195).toFixed(6)), drop_lng: 76.0 });
