import { Worker } from "bullmq";
import { TransactionStatus } from "@prisma/client";
import { getRedisOptions } from "../queues/redis.js";
import {
  ConfirmPaymentJobData,
  ExpireEscrowJobData,
  ExpireInspectionJobData,
  ExpirePendingJobData,
  scheduleRefund,
} from "../queues/index.js";
import { prisma } from "../db/prisma.js";
import { processWebhookPayment } from "../services/payments.service.js";
import { systemUpdateTransactionStatus } from "../services/transactions.service.js";

export const startTransactionWorker = () => {
  const worker = new Worker(
    "transactions",
    async (job) => {
      switch (job.name) {
        case "expire-pending": {
          const { transactionId } = job.data as ExpirePendingJobData;
          const tx = await prisma.transaction.findUnique({
            where: { id: transactionId },
            select: { status: true },
          });

          if (!tx) {
            console.warn(`[Worker:transactions] expire-pending: tx ${transactionId} not found`);
            return;
          }

          if (tx.status !== TransactionStatus.PENDING) {
            // Payment went through (or already cancelled) — nothing to do.
            console.log(`[Worker:transactions] expire-pending: tx ${transactionId} already at ${tx.status} — skipping`);
            return;
          }

          await systemUpdateTransactionStatus(
            transactionId,
            TransactionStatus.CANCELLED,
            "Payment not completed within 24 hours. Listing relisted automatically.",
          );
          console.log(`[Worker:transactions] Expired unpaid pending tx ${transactionId}`);
          break;
        }

        case "confirm-payment": {
          const { paymentReference, amount, currency, gateway } = job.data as ConfirmPaymentJobData;
          await processWebhookPayment(paymentReference, amount, currency, gateway);
          console.log(`[Worker:transactions] Payment confirmed for ref ${paymentReference}`);
          break;
        }

        case "expire-inspection": {
          const { transactionId } = job.data as ExpireInspectionJobData;
          const tx = await prisma.transaction.findUnique({
            where: { id: transactionId },
            select: { status: true },
          });

          if (!tx) {
            console.warn(`[Worker:transactions] expire-inspection: tx ${transactionId} not found`);
            return;
          }

          if (tx.status !== TransactionStatus.SELLER_DISPATCHED) {
            console.log(`[Worker:transactions] expire-inspection: tx ${transactionId} already at ${tx.status} — skipping`);
            return;
          }

          await systemUpdateTransactionStatus(
            transactionId,
            TransactionStatus.BUYER_VERIFIED,
            "System: 48-hour inspection window expired — delivery auto-confirmed.",
            { autoVerified: true },
          );
          console.log(`[Worker:transactions] Auto-verified tx ${transactionId}`);
          break;
        }

        case "expire-escrow": {
          const { transactionId } = job.data as ExpireEscrowJobData;
          const tx = await prisma.transaction.findUnique({
            where: { id: transactionId },
            select: {
              status: true,
              paymentReference: true,
              amount: true,
              currency: true,
            },
          });

          if (!tx) {
            console.warn(`[Worker:transactions] expire-escrow: tx ${transactionId} not found`);
            return;
          }

          if (tx.status !== TransactionStatus.ESCROW_HELD) {
            console.log(`[Worker:transactions] expire-escrow: tx ${transactionId} already at ${tx.status} — skipping`);
            return;
          }

          await scheduleRefund({
            transactionId,
            paymentReference: tx.paymentReference ?? "",
            amount: Number(tx.amount),
            currency: tx.currency,
            reason: "Seller did not dispatch within 7 days. Automatic refund issued.",
          });

          console.log(`[Worker:transactions] Escrow expired for tx ${transactionId} — refund queued`);
          break;
        }

        default:
          console.warn(`[Worker:transactions] Unknown job: ${job.name}`);
      }
    },
    { connection: getRedisOptions() },
  );

  worker.on("failed", (job, err) => {
    console.error(`[Worker:transactions] Job "${job?.name}" (${job?.id}) failed:`, err.message);
  });

  console.log("[Worker:transactions] Started");
  return worker;
};
