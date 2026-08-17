/**
 * One-time bootstrap script to create the first ADMIN account.
 *
 * Usage:
 *   bun run scripts/create-admin.ts <email> <password> "<display name>"
 *
 * Example:
 *   bun run scripts/create-admin.ts admin@tavewo.com "StrongPass123!" "Tavewo Admin"
 *
 * The script is idempotent — if an account with that email already exists it
 * prints its current role and exits without making any changes.
 */

import "dotenv/config";
import { AccountRole } from "@prisma/client";
import { prisma } from "../src/db/prisma.js";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
};

const [email, password, displayName] = process.argv.slice(2);

if (!email || !password || !displayName) {
  console.error(
    'Usage: bun run scripts/create-admin.ts <email> <password> "<display name>"',
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

try {
  const existing = await prisma.account.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, role: true },
  });

  if (existing) {
    console.log(
      `Account already exists (id: ${existing.id}, role: ${existing.role}).`,
    );
    if (existing.role !== AccountRole.ADMIN) {
      console.log("Promoting existing account to ADMIN...");
      await prisma.account.update({
        where: { id: existing.id },
        data: { role: AccountRole.ADMIN },
      });
      console.log("Done — account is now ADMIN.");
    } else {
      console.log("Already an ADMIN — nothing to do.");
    }
    process.exit(0);
  }

  const passwordHash = await hashPassword(password);

  const account = await prisma.account.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      role: AccountRole.ADMIN,
      emailVerified: true, // skip OTP on first setup
      profile: {
        create: { displayName },
      },
    },
    select: { id: true, email: true, role: true },
  });

  console.log("Admin account created successfully:");
  console.log(`  ID:    ${account.id}`);
  console.log(`  Email: ${account.email}`);
  console.log(`  Role:  ${account.role}`);
  console.log("");
  console.log("Log in via POST /api/v1/auth/login with these credentials.");
} finally {
  await prisma.$disconnect().catch(() => {});
}
