// Creates (or resets the PIN of) the global Super Admin — the first account
// on a fresh production database. The demo seed is for development only.
//
//   SUPER_ADMIN_PHONE=9XXXXXXXXX SUPER_ADMIN_NAME="Your Name" \
//     node scripts/create-super-admin.mjs            # prompts for the PIN
//   ... SUPER_ADMIN_PIN=...  (non-interactive; avoid shell history)
//   ... node scripts/create-super-admin.mjs --reset-pin
//
// Idempotent: an existing Super Admin is left alone unless --reset-pin.

import readline from "node:readline";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {
  /* real environment variables are fine */
}

const phone = String(process.env.SUPER_ADMIN_PHONE ?? "").replace(/\D/g, "").slice(-10);
const name = (process.env.SUPER_ADMIN_NAME || "Super Admin").trim();
const reset = process.argv.includes("--reset-pin");

if (!/^[6-9]\d{9}$/.test(phone)) {
  console.error("Set SUPER_ADMIN_PHONE to a valid 10-digit mobile number.");
  process.exit(1);
}

/** Reads a line without echoing it. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findFirst({
    where: { franchise_id: null, role: "SUPER_ADMIN", phone },
  });
  if (existing && !reset) {
    console.log(`Super Admin ${phone} already exists. Use --reset-pin to change the PIN.`);
  } else {
    let pin = process.env.SUPER_ADMIN_PIN;
    if (!pin) {
      pin = await askHidden("New PIN (6 to 12 characters): ");
      if (pin !== (await askHidden("Repeat PIN: "))) throw new Error("PINs do not match.");
    }
    // Login accepts 4-12 characters; a longer PIN could never sign in.
    if (pin.length < 6 || pin.length > 12) throw new Error("The Super Admin PIN must be 6 to 12 characters.");
    const pin_hash = await argon2.hash(pin);
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { pin_hash, is_active: true, name } });
      await prisma.refreshToken.updateMany({ where: { user_id: existing.id, revoked: false }, data: { revoked: true } });
      console.log(`PIN reset for ${phone}; all existing sessions were signed out.`);
    } else {
      await prisma.user.create({
        data: { franchise_id: null, role: "SUPER_ADMIN", name, phone, pin_hash },
      });
      console.log(`Super Admin created: ${phone}. Sign in at admin.<your-domain> with this phone and PIN.`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
