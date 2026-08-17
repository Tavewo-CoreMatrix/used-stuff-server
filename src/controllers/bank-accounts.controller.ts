import { AccountRole } from "@prisma/client";
import type { RequestHandler } from "express";
import { verifyBankAccount, upsertBankAccount, listBanks } from "../services/bank-accounts.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readRouteParam } from "../utils/request.js";

export const listBanksHandler: RequestHandler = asyncHandler(async (_request, response) => {
  const banks = await listBanks();
  response.json({ data: banks.map((bank) => ({ name: bank.name, code: bank.code })) });
});

export const verifyBankAccountHandler: RequestHandler = asyncHandler(async (request, response) => {
  const accountNumber = String(request.query.account_number ?? "").trim();
  const bankCode = String(request.query.bank_code ?? "").trim();

  if (!accountNumber || !bankCode) {
    throw new HttpError(400, "account_number and bank_code query params are required");
  }
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new HttpError(400, "accountNumber must be exactly 10 digits");
  }

  const result = await verifyBankAccount(accountNumber, bankCode);
  response.json({ data: result });
});

export const upsertBankAccountHandler: RequestHandler = asyncHandler(async (request, response) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");

  const targetAccountId = readRouteParam(request.params.accountId, "accountId");

  if (request.auth.role !== AccountRole.ADMIN && request.auth.accountId !== targetAccountId) {
    throw new HttpError(403, "You can only update your own bank account");
  }

  const { bankCode, accountNumber } = request.body;
  if (!bankCode || !accountNumber) {
    throw new HttpError(400, "bankCode and accountNumber are required");
  }

  // Re-verify with Paystack — use the bank-confirmed name and normalised account
  // number rather than trusting whatever the client sent.
  const verified = await verifyBankAccount(String(accountNumber), String(bankCode));

  const bankAccount = await upsertBankAccount(targetAccountId, {
    bankCode: String(bankCode),
    accountNumber: verified.accountNumber,
    accountName: verified.accountName,
  });
  response.json({ data: bankAccount });
});
