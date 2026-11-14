import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { config } from "../src/config.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
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

