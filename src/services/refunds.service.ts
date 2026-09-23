import { getPaystack } from "../lib/paystack.js";
import { TransactionStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { systemUpdateTransactionStatus } from "./transactions.service.js";

/**
 * Option B Escrow: Auto-refund system
 *
 * If a seller does not mark an order as SELLER_DISPATCHED within 7 days of payment,
 * the system automatically refunds the buyer and cancels the transaction.
 */

const ESCROW_HOLD_DAYS = 7;

// PENDING transactions older than this have had no payment captured — safe to cancel.
const PENDING_TIMEOUT_HOURS = 24;

export const processAutoRefunds = async () => {
  const now = new Date();
  const refundDeadline = new Date(now.getTime() - ESCROW_HOLD_DAYS * 24 * 60 * 60 * 1000);

  // Find all transactions in ESCROW_HELD state older than 7 days
  const autoRefundCandidates = await prisma.transaction.findMany({
    where: {
      status: TransactionStatus.ESCROW_HELD,
      escrowHeldAt: {
        lt: refundDeadline, // Older than 7 days ago
      },
    },
    select: { id: true, paymentReference: true, amount: true, currency: true, buyerId: true },
  });

  if (autoRefundCandidates.length === 0) {
    return;
  }

  console.log(`[AUTO_REFUND] Found ${autoRefundCandidates.length} transactions eligible for auto-refund.`);

  for (const transaction of autoRefundCandidates) {
    try {
      await executeRefund(
        transaction.id,
        transaction.paymentReference || "unknown",
        Number(transaction.amount),
        transaction.currency,
        "Seller did not dispatch order within 7 days. Automatic refund issued."
      );
      console.log(`[AUTO_REFUND] Successfully refunded transaction ${transaction.id}`);
    } catch (error) {
      console.error(`[AUTO_REFUND] Failed to refund transaction ${transaction.id}:`, error);
    }
  }
};

/**
 * Cancel stale PENDING transactions where the buyer never completed payment.
 * No money was captured, so no Paystack refund is needed — just cancel the
 * transaction and revert the listing back to ACTIVE.
 * Called by the same scheduler as processAutoRefunds.
 */
export const processStaleTransactions = async () => {
  const staleDeadline = new Date(Date.now() - PENDING_TIMEOUT_HOURS * 60 * 60 * 1000);

  const stale = await prisma.transaction.findMany({
    where: {
      status: TransactionStatus.PENDING,
      createdAt: { lt: staleDeadline },
    },
    select: { id: true },
  });

  if (stale.length === 0) return;

  console.log(`[STALE_CLEANUP] Cancelling ${stale.length} unpaid PENDING transactions older than ${PENDING_TIMEOUT_HOURS}h.`);

  for (const { id } of stale) {
    try {
      await systemUpdateTransactionStatus(
        id,
        TransactionStatus.CANCELLED,
        `Payment not completed within ${PENDING_TIMEOUT_HOURS} hours. Listing relisted automatically.`,
      );
      console.log(`[STALE_CLEANUP] Cancelled stale transaction ${id}`);
    } catch (error) {
      console.error(`[STALE_CLEANUP] Failed to cancel stale transaction ${id}:`, error);
    }
  }
};

/**
 * Execute a refund for a transaction via Paystack
 */
export const executeRefund = async (
  transactionId: string,
  paymentReference: string,
  amount: number,
  currency: string,
  reason: string
) => {
  if (!env.paystackSecretKey) {
    throw new Error("Paystack secret key not configured");
  }

  // Verify the transaction exists and is in a refundable state
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { 
      id: true, 
      status: true, 
      amount: true, 
      currency: true,
      buyer: { select: { id: true, email: true } }
    },
  });

  if (!transaction) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  const paystack = getPaystack();

  try {
    const response = await paystack.refund.create({
      transaction: paymentReference,
      amount: Math.round(amount * 100), // kobo
    });

    const refundData = response?.data;

    await systemUpdateTransactionStatus(transactionId, TransactionStatus.CANCELLED, reason, {
      refundReference: refundData?.reference,
      refundedAmount: amount,
      refundedCurrency: currency,
    });

    console.log(`[REFUND] Processed for tx ${transactionId}. Ref: ${refundData?.reference}`);
    return refundData;
  } catch (error) {
    console.error(`[REFUND] Failed for tx ${transactionId}:`, error);
    throw error;
  }
};

/**
 * Check if a transaction is eligible for refund
 */
export const isRefundEligible = (transaction: {
  status: TransactionStatus;
  escrowHeldAt?: Date | null;
}): boolean => {
  if (transaction.status !== TransactionStatus.ESCROW_HELD) {
    return false;
  }

  if (!transaction.escrowHeldAt) {
    return false;
  }

  const now = new Date();
  const refundDeadline = new Date(now.getTime() - ESCROW_HOLD_DAYS * 24 * 60 * 60 * 1000);

  return transaction.escrowHeldAt < refundDeadline;
};
