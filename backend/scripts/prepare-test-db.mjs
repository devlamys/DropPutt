// Creates the separate test database (if missing) and applies migrations.
// Tests TRUNCATE every table, so they must never run against dev data:
// the database name has to end in "_test".

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import "../test/helpers/env.js";

const target = new URL(process.env.DATABASE_URL);
const dbName = target.pathname.slice(1);
if (!dbName.endsWith("_test")) throw new Error(`Refusing to prepare "${dbName}": not a _test database`);

const admin = new URL(target);
admin.pathname = "/postgres";
admin.search = "";
const prisma = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
try {
  const rows = await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${dbName.replace(/'/g, "''")}'`);
  if (rows.length === 0) {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`[test-db] created ${dbName}`);
  }
} finally {
  await prisma.$disconnect();
}

execFileSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
  cwd: new URL("..", import.meta.url),
});
console.log(`[test-db] ${dbName} is up to date`);
