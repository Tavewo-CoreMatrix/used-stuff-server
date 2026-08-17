import { Queue } from "bullmq";
import { getRedisOptions } from "./redis.js";

// ── Job data shapes ────────────────────────────────────────────────────────

export type ConfirmPaymentJobData = {
  paymentReference: string;
  amount: number;
  currency: string;
  gateway: "paystack" | "flutterwave";
};

export type ExpireInspectionJobData = { transactionId: string };
export type ExpireEscrowJobData    = { transactionId: string };
export type ExpirePendingJobData   = { transactionId: string };

export type ReleasePayoutJobData = { transactionId: string };

export type ProcessRefundJobData = {
  transactionId: string;
  paymentReference: string;
  amount: number;
  currency: string;
  reason: string;
};

// ── Queue definitions ──────────────────────────────────────────────────────

export const transactionsQueue = new Queue("transactions", {
  connection: getRedisOptions(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 7 * 24 * 60 * 60 },
    removeOnFail: false,
  },
});

export const payoutsQueue = new Queue("payouts", {
  connection: getRedisOptions(),
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 30 * 24 * 60 * 60 },
    removeOnFail: false,
  },
});

export const refundsQueue = new Queue("refunds", {
  connection: getRedisOptions(),
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 30 * 24 * 60 * 60 },
    removeOnFail: false,
  },
});

// ── Scheduling helpers (called by services after DB commits) ───────────────

const MS = {
  hours: (n: number) => n * 60 * 60 * 1000,
  days: (n: number) => n * 24 * 60 * 60 * 1000,
};

// Hyphens used in jobId strings — BullMQ rejects colons in custom IDs
// because it uses them as Redis key separators internally.

export const schedulePaymentConfirmation = (data: ConfirmPaymentJobData) =>
  transactionsQueue.add("confirm-payment", data, {
    jobId: `confirm-payment-${data.paymentReference}`,
  });

export const schedulePendingExpiry = (transactionId: string) =>
  transactionsQueue.add(
    "expire-pending",
    { transactionId } satisfies ExpirePendingJobData,
    {
      delay: MS.hours(24),
      jobId: `expire-pending-${transactionId}`,
    },
  );

export const scheduleInspectionDeadline = (transactionId: string) =>
  transactionsQueue.add(
    "expire-inspection",
    { transactionId } satisfies ExpireInspectionJobData,
    {
      delay: MS.hours(48),
      jobId: `expire-inspection-${transactionId}`,
    },
  );

export const scheduleEscrowTimeout = (transactionId: string) =>
  transactionsQueue.add(
    "expire-escrow",
    { transactionId } satisfies ExpireEscrowJobData,
    {
      delay: MS.days(7),
      jobId: `expire-escrow-${transactionId}`,
    },
  );

export const scheduleSellerPayout = (transactionId: string) =>
  payoutsQueue.add(
    "release-payout",
    { transactionId } satisfies ReleasePayoutJobData,
    {
      jobId: `release-payout-${transactionId}`,
    },
  );

export const scheduleRefund = (data: ProcessRefundJobData) =>
  refundsQueue.add("process-refund", data, {
    jobId: `process-refund-${data.transactionId}`,
  });
