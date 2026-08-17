import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";

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

  const body = (await response.json()) as { status: boolean; data?: { account_name: string; account_number: string } };

  if (!response.ok || !body.status || !body.data?.account_name) {
    throw new HttpError(422, "Could not resolve account. Check the account number and bank.");
  }

  return {
    accountName: body.data.account_name,
    accountNumber: body.data.account_number,
  };
};

export const upsertBankAccount = async (
  accountId: string,
  data: { bankCode: string; accountNumber: string; accountName: string },
) => {
  return prisma.bankAccount.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
};
