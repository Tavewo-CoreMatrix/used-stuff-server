import { describe, expect, it, vi, beforeEach } from "vitest";
import { TransactionStatus } from "@prisma/client";
import { prisma } from "../setup.js";

let capturedProcessor: ((job: { name: string; data: any }) => Promise<void>) | null = null;

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function (_name: string, processor: any) {
    capturedProcessor = processor;
    return { on: vi.fn() };
  }),
}));

vi.mock("../../src/queues/index.js", () => ({
  scheduleRefund: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/queues/redis.js", () => ({
  getRedisOptions: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/services/payments.service.js", () => ({
  processWebhookPayment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/services/transactions.service.js", () => ({
  systemUpdateTransactionStatus: vi.fn().mockResolvedValue(undefined),
}));

import { startTransactionWorker } from "../../src/workers/transaction.worker.js";
import { scheduleRefund } from "../../src/queues/index.js";
import { systemUpdateTransactionStatus } from "../../src/services/transactions.service.js";

describe("transaction.worker — dispute freezes automated actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = null;
    startTransactionWorker();
  });

  describe("expire-inspection", () => {
    it("auto-verifies when the transaction is still SELLER_DISPATCHED", async () => {
      prisma.transaction.findUnique.mockResolvedValue({ status: TransactionStatus.SELLER_DISPATCHED });

      await capturedProcessor!({ name: "expire-inspection", data: { transactionId: "txn-1" } });

      expect(systemUpdateTransactionStatus).toHaveBeenCalledWith(
        "txn-1",
        TransactionStatus.BUYER_VERIFIED,
        expect.any(String),
        expect.objectContaining({ autoVerified: true }),
      );
    });

    it("skips auto-verify when a dispute was opened in the meantime", async () => {
      prisma.transaction.findUnique.mockResolvedValue({ status: TransactionStatus.DISPUTED });

      await capturedProcessor!({ name: "expire-inspection", data: { transactionId: "txn-1" } });

      expect(systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });
  });

  describe("expire-escrow", () => {
    it("queues a refund when the transaction is still ESCROW_HELD", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        status: TransactionStatus.ESCROW_HELD,
        paymentReference: "ref-1",
        amount: 1000,
        currency: "NGN",
      });

      await capturedProcessor!({ name: "expire-escrow", data: { transactionId: "txn-1" } });

      expect(scheduleRefund).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: "txn-1", paymentReference: "ref-1" }),
      );
    });

    it("skips the refund when a dispute was opened in the meantime", async () => {
      prisma.transaction.findUnique.mockResolvedValue({ status: TransactionStatus.DISPUTED });

      await capturedProcessor!({ name: "expire-escrow", data: { transactionId: "txn-1" } });

      expect(scheduleRefund).not.toHaveBeenCalled();
    });
  });
});
