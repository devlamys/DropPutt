import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

/** @type {PrismaClient} */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
