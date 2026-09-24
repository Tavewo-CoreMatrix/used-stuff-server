import { TransactionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getPaystack } from "../lib/paystack.js";
import { notifyPayoutSettled } from "./notifications.service.js";

export const PLATFORM_FEE_RATE = 0.07; // 7% — keep in sync with mobile's PLATFORM_FEE_RATE (My Listings payout estimate)

// When Paystack refuses a request it answers { status: false, message } instead of throwing,
// so the message is the only clue to why (balance, account not enabled for payouts, ...).
const paystackReason = (response: unknown): string => {
  const message = (response as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message ? `: ${message}` : "";
};

// Records that a payout gave up, so it shows under Failed payouts in the admin app.
export const markPayoutFailed = async (transactionId: string, reason: string): Promise<void> => {
  await prisma.transaction.updateMany({
    where: { id: transactionId, payoutSettledAt: null },
    data: { payoutFailedAt: new Date(), payoutFailureReason: reason.slice(0, 500) },
  });
};

// Paystack requires OTP-less transfers: Settings → Preferences → Disable OTP for transfers.

const createTransferRecipient = async (
  accountName: string,
  accountNumber: string,
  bankCode: string,
  currency = "NGN",
): Promise<string> => {
  const paystack = getPaystack();
  const response = await paystack.transferrecipient.create({
    type: "nuban",
    name: accountName,
    account_number: accountNumber,
    bank_code: bankCode,
    currency,
  });

  const recipientCode = response?.data?.recipient_code;
  if (!recipientCode) throw new Error(`Paystack did not return a recipient_code${paystackReason(response)}`);
  return recipientCode;
};

const initiateTransfer = async (
  recipientCode: string,
  amountInKobo: number,
  reference: string,
  reason: string,
): Promise<string> => {
  const paystack = getPaystack();
  const response = await paystack.transfer.initiate({
    source: "balance",
    recipient: recipientCode,
    amount: amountInKobo,
    reference,
    reason,
  });

  const transferCode = response?.data?.transfer_code;
  if (!transferCode) throw new Error(`Paystack did not return a transfer_code${paystackReason(response)}`);
  return transferCode;
};

export const executeSellerPayout = async (transactionId: string): Promise<void> => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { seller: { include: { bankAccount: true } } },
  });

  if (!transaction) throw new Error(`Transaction ${transactionId} not found for payout`);
  if (transaction.status !== TransactionStatus.PAYOUT_RELEASED) {
    throw new Error(`Transaction ${transactionId} is not PAYOUT_RELEASED`);
  }

  // Idempotency: if a transfer was already initiated (e.g. job retried), skip.
  if (transaction.payoutTransferCode) {
    console.log(`[PAYOUT] Transfer already initiated for tx ${transactionId} (${transaction.payoutTransferCode}) — skipping`);
    return;
  }

  const bankAccount = transaction.seller.bankAccount;
  if (!bankAccount) {
    console.error(`[PAYOUT] Seller ${transaction.sellerId} has no bank account — payout paused for tx ${transactionId}`);
    return;
  }

  const gross = Number(transaction.amount);
  const payout = gross - gross * PLATFORM_FEE_RATE;
  const amountInKobo = Math.round(payout * 100);

  console.log(`[PAYOUT] Initiating ₦${payout} transfer to ${bankAccount.accountName} for tx ${transactionId}`);

  const recipientCode = await createTransferRecipient(
    bankAccount.accountName,
    bankAccount.accountNumber,
    bankAccount.bankCode,
    transaction.currency,
  );

  const transferCode = await initiateTransfer(
    recipientCode,
    amountInKobo,
    `payout_${transactionId}`,
    `Tavewo payout for order ${transaction.orderNumber}`,
  );

  // Persist immediately — if the worker crashes after this point, the idempotency
  // guard above prevents a second transfer being initiated on retry.
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { payoutTransferCode: transferCode },
  });

  console.log(`[PAYOUT] Transfer initiated: ${transferCode} for tx ${transactionId}`);
};

export const handleTransferWebhook = async (
  transferCode: string,
  event: "transfer.success" | "transfer.failed" | "transfer.reversed",
  failureReason?: string,
): Promise<void> => {
  const transaction = await prisma.transaction.findFirst({
    where: { payoutTransferCode: transferCode },
    select: { id: true, orderNumber: true, payoutSettledAt: true },
  });

  if (!transaction) {
    console.warn(`[TRANSFER_WEBHOOK] No transaction for transfer code ${transferCode} — possibly not a payout transfer`);
    return;
  }

  if (event === "transfer.success") {
    // Idempotency: Paystack retries webhooks — skip if already processed.
    if (transaction.payoutSettledAt) {
      console.log(`[TRANSFER_WEBHOOK] Transfer ${transferCode} already settled — skipping duplicate webhook`);
      return;
    }

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { payoutSettledAt: new Date() },
    });

    await notifyPayoutSettled(transaction.id);

    console.log(`[TRANSFER_WEBHOOK] Transfer ${transferCode} settled — tx ${transaction.id} (${transaction.orderNumber})`);
  } else {
    // transfer.failed or transfer.reversed
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        payoutFailedAt: new Date(),
        payoutFailureReason: failureReason ?? event,
      },
    });

    console.error(
      `[TRANSFER_WEBHOOK] Transfer ${transferCode} ${event} for tx ${transaction.id} — reason: ${failureReason ?? "unknown"}`,
    );
  }
};
