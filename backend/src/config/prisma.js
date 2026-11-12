import "./env.js";
import { PrismaClient } from "@prisma/client";

// One PrismaClient per process.
export const prisma = new PrismaClient();

// Options for money / race-sensitive interactive transactions.
export const TX_OPTIONS = Object.freeze({ maxWait: 5000, timeout: 15000 });
