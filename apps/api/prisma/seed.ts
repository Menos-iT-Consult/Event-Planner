import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "../src/config.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rates = [
    ["WEDDING_DAILY_RATE", config.WEDDING_DAILY_RATE, "Daily rate for wedding events"],
    ["VOTING_DAILY_RATE", config.VOTING_DAILY_RATE, "Daily rate for voting events"],
    ["GENERAL_DAILY_RATE", config.GENERAL_DAILY_RATE, "Daily rate for general events"],
  ] as const;

  for (const [key, value, description] of rates) {
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: new Prisma.Decimal(value), description },
      update: {},
    });
  }

  if (Boolean(config.ADMIN_EMAIL) !== Boolean(config.ADMIN_PASSWORD)) {
    throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD to seed the initial administrator");
  }
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 12);
    await prisma.user.upsert({
      where: { email: config.ADMIN_EMAIL.toLowerCase() },
      create: {
        email: config.ADMIN_EMAIL.toLowerCase(),
        name: "Platform Administrator",
        passwordHash,
        role: "ADMIN",
      },
      update: { passwordHash, role: "ADMIN" },
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error("EventFlow seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

