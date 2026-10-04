import crypto from "node:crypto";
import { TransactionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { getPaystack } from "../lib/paystack.js";
import { systemUpdateTransactionStatus } from "./transactions.service.js";

export const initializePaystackPayment = async (
  email: string,
  amount: number,
  reference: string,
  callbackUrl: string,
) => {
  const paystack = getPaystack();
  const response = await paystack.transaction.initialize({
    email,
    amount: Math.round(amount * 100), // kobo
    reference,
    callback_url: callbackUrl,
  });

  const { data } = response;
  if (!data?.authorization_url) {
    throw new HttpError(502, "Failed to initialize Paystack payment");
  }

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
};

export const verifyPaystackSignature = (rawBody: Buffer, signature: string): boolean => {
  if (!env.paystackSecretKey) throw new HttpError(500, "Paystack secret key is not configured");

  const hash = crypto.createHmac("sha512", env.paystackSecretKey).update(rawBody).digest("hex");
  const hashBuffer = Buffer.from(hash);
  const sigBuffer = Buffer.from(signature);

  if (hashBuffer.length !== sigBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, sigBuffer);
};

export const verifyFlutterwaveSignature = (signature: string): boolean => {
  if (!env.flutterwaveSecretHash) throw new HttpError(500, "Flutterwave secret hash is not configured");

  // Timing-safe, matching the Paystack check above — a plain === here would
  // leak how many leading characters matched via response-time differences.
  const expected = Buffer.from(env.flutterwaveSecretHash);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
};

/**
 * Shared transition logic for moving a transaction PENDING -> ESCROW_HELD once a
 * payment is confirmed. Idempotent (no-ops if already past PENDING) so it's safe to
 * call from both the async webhook path and a synchronous confirm call — whichever
 * arrives first wins, the other is a harmless no-op.
 */
const confirmTransactionPayment = async (
  transaction: { id: string; amount: unknown; currency: string; status: TransactionStatus },
  amount: number,
  currency: string,
  gateway: "paystack" | "flutterwave",
  source: "webhook" | "sync",
) => {
  if (transaction.status !== TransactionStatus.PENDING) {
    console.warn(`[PAYMENT:${source}] Transaction ${transaction.id} already ${transaction.status} — skipping`);
    return false;
  }

  if (Number(transaction.amount) !== amount || transaction.currency !== currency) {
    console.error(
      `[PAYMENT:${source}] Amount/currency mismatch for ${transaction.id}. Expected ${transaction.amount} ${transaction.currency}, got ${amount} ${currency}`,
    );
    return false;
  }

  await systemUpdateTransactionStatus(transaction.id, TransactionStatus.ESCROW_HELD, `Payment confirmed via ${source}`, {
    gateway,
  });

  console.log(`[PAYMENT:${source}] Transaction ${transaction.id} moved to ESCROW_HELD via ${gateway}`);
  return true;
};

export const processWebhookPayment = async (
  paymentReference: string,
  amount: number,
  currency: string,
  gateway: "paystack" | "flutterwave",
) => {
  const transaction = await prisma.transaction.findUnique({
    where: { paymentReference },
    select: { id: true, amount: true, currency: true, status: true },
  });

  if (!transaction) {
    console.warn(`[WEBHOOK] No transaction for reference ${paymentReference}`);
    return;
  }

  await confirmTransactionPayment(transaction, amount, currency, gateway, "webhook");
};

/**
 * Backstop for a genuinely failed charge (declined card, insufficient funds, etc.).
 * Immediately cancels the still-PENDING transaction and frees the listing, rather
 * than leaving it RESERVED until the 24h stale-transaction sweep catches it. No-ops
 * if the transaction already moved past PENDING (e.g. a late/duplicate webhook).
 */
export const processWebhookPaymentFailure = async (
  paymentReference: string,
  gateway: "paystack" | "flutterwave",
  reason?: string,
) => {
  const transaction = await prisma.transaction.findUnique({
    where: { paymentReference },
    select: { id: true, status: true },
  });

  if (!transaction) {
    console.warn(`[WEBHOOK] No transaction for reference ${paymentReference}`);
    return;
  }

  if (transaction.status !== TransactionStatus.PENDING) {
    console.warn(`[PAYMENT:webhook] Transaction ${transaction.id} already ${transaction.status} — skipping failure cancel`);
    return;
  }

  await systemUpdateTransactionStatus(
    transaction.id,
    TransactionStatus.CANCELLED,
    reason ? `Payment failed via ${gateway}: ${reason}` : `Payment failed via ${gateway}`,
    { gateway },
  );

  console.log(`[PAYMENT:webhook] Transaction ${transaction.id} cancelled after failed ${gateway} charge`);
};

/**
 * Buyer-initiated synchronous confirmation, called right after the mobile Paystack
 * checkout reports success. Verifies the charge with Paystack directly instead of
 * waiting for the async webhook, so the seller isn't stuck seeing "awaiting payment".
 */
export const confirmPaymentSync = async (transactionId: string, accountId: string) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, buyerId: true, amount: true, currency: true, status: true, paymentReference: true },
  });

  if (!transaction) {
    throw new HttpError(404, "Transaction not found");
  }

  if (transaction.buyerId !== accountId) {
    throw new HttpError(403, "Only the buyer can confirm this payment");
  }

  if (transaction.status !== TransactionStatus.PENDING) {
    // Already confirmed (e.g. webhook beat us to it) — nothing to do.
    return;
  }

  if (!transaction.paymentReference) {
    throw new HttpError(409, "Transaction has no payment reference to verify");
  }

  const paystack = getPaystack();
  const response = await paystack.transaction.verify({ reference: transaction.paymentReference });
  const data = response?.data as { status?: string; amount?: number; currency?: string } | undefined;

  if (data?.status !== "success") {
    throw new HttpError(409, "Payment not yet confirmed by Paystack");
  }

  const verifiedAmount = Number(data.amount) / 100; // kobo -> naira
  const verifiedCurrency = data.currency ?? transaction.currency;

  await confirmTransactionPayment(transaction, verifiedAmount, verifiedCurrency, "paystack", "sync");
};
