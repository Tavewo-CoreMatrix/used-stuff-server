import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { verifyPassword } from "../utils/password.js";

const normalizeAnswer = (answer: string) => answer.trim().toLowerCase();

// Sellers can change an already-saved bank account at most once per this window —
// protects payout destination from being silently redirected by a hijacked session.
const BANK_ACCOUNT_CHANGE_COOLDOWN_DAYS = 30;

type PaystackBank = { name: string; code: string; active: boolean };

let bankListCache: { banks: PaystackBank[]; fetchedAt: number } | null = null;
const BANK_LIST_TTL_MS = 24 * 60 * 60 * 1000; // Paystack's bank list rarely changes — cache for a day.

// Uses Paystack REST API directly:
// https://paystack.com/docs/miscellaneous/list-of-banks/
export const listBanks = async () => {
  if (bankListCache && Date.now() - bankListCache.fetchedAt < BANK_LIST_TTL_MS) {
    return bankListCache.banks;
  }

  const response = await fetch("https://api.paystack.co/bank?country=nigeria&currency=NGN", {
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      "Content-Type": "application/json",
    },
  });

  const body = (await response.json()) as { status: boolean; data?: PaystackBank[] };

  if (!response.ok || !body.status || !body.data) {
    // Serve stale cache rather than fail the request outright, if we have one.
    if (bankListCache) return bankListCache.banks;
    throw new HttpError(502, "Could not fetch bank list from Paystack.");
  }

  // Paystack's list can contain multiple entries sharing one bank code (different
  // settlement channels for the same institution) — dedupe by code, keeping the first.
  const seenCodes = new Set<string>();
  const banks = body.data
    .filter((bank) => bank.active)
    .filter((bank) => (seenCodes.has(bank.code) ? false : (seenCodes.add(bank.code), true)))
    .sort((a, b) => a.name.localeCompare(b.name));

  bankListCache = { banks, fetchedAt: Date.now() };
  return banks;
};

// Uses Paystack REST API directly:
// https://paystack.com/docs/identity-verification/verify-account-number/#resolve-account-number
export const verifyBankAccount = async (accountNumber: string, bankCode: string) => {
  const url = `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.paystackSecretKey}`,
      "Content-Type": "application/json",
    },
  });

  const body = (await response.json()) as {
    status: boolean;
    message?: string;
    data?: { account_name: string; account_number: string };
  };

  if (!response.ok || !body.status || !body.data?.account_name) {
    // The generic client-facing message hides real causes (wrong bank code,
    // a test-mode key that can't resolve real accounts, Paystack downtime,
    // etc.) — log Paystack's own message so it's actually debuggable.
    console.error(`[Paystack] bank/resolve failed (HTTP ${response.status}) for bank_code=${bankCode}:`, body.message || body);
    throw new HttpError(422, body.message || "Could not resolve account. Check the account number and bank.");
  }

  return {
    accountName: body.data.account_name,
    accountNumber: body.data.account_number,
  };
};

export const upsertBankAccount = async (
  accountId: string,
  data: { bankCode: string; accountNumber: string; accountName: string },
  options: { securityAnswer?: string; skipVerification?: boolean } = {},
) => {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      securityAnswerHash: true,
      bankAccount: { select: { updatedAt: true } },
    },
  });

  if (!account) {
    throw new HttpError(404, "Account not found");
  }

  // Only changes to an EXISTING bank account are rate-limited and require
  // re-verification — first-time setup has nothing to protect yet.
  if (account.bankAccount && !options.skipVerification) {
    const cooldownMs = BANK_ACCOUNT_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const nextAllowedAt = new Date(account.bankAccount.updatedAt.getTime() + cooldownMs);

    if (nextAllowedAt > new Date()) {
      throw new HttpError(
        409,
        `You can only change your bank account once every ${BANK_ACCOUNT_CHANGE_COOLDOWN_DAYS} days. Try again after ${nextAllowedAt.toISOString().slice(0, 10)}.`,
      );
    }

    if (!account.securityAnswerHash) {
      throw new HttpError(400, "Set up your security question in Profile > Security before changing your bank account.");
    }

    if (!options.securityAnswer) {
      throw new HttpError(400, "securityAnswer is required to change your bank account");
    }

    if (!(await verifyPassword(normalizeAnswer(options.securityAnswer), account.securityAnswerHash))) {
      throw new HttpError(403, "That answer doesn't match.");
    }
  }

  return prisma.bankAccount.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
};
