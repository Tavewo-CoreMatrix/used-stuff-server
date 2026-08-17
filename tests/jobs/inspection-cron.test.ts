import { describe, expect, it, vi, beforeEach } from "vitest";
import { TransactionStatus } from "@prisma/client";
import { processExpiredInspections } from "../../src/jobs/inspection-cron.js";
import { prisma } from "../setup.js";
import * as transactionsService from "../../src/services/transactions.service.js";

vi.mock("../../src/services/transactions.service.js", () => ({
  systemUpdateTransactionStatus: vi.fn(),
}));

describe("inspection-cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("processExpiredInspections", () => {
    it("does nothing if no expired transactions found", async () => {
      prisma.transaction.findMany.mockResolvedValue([]);

      await processExpiredInspections();

      expect(prisma.transaction.findMany).toHaveBeenCalled();
      expect(transactionsService.systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });

    it("auto-verifies expired transactions", async () => {
      prisma.transaction.findMany.mockResolvedValue([
        { id: "txn-1" } as any,
        { id: "txn-2" } as any,
      ]);

      await processExpiredInspections();

      expect(transactionsService.systemUpdateTransactionStatus).toHaveBeenCalledTimes(2);
      expect(transactionsService.systemUpdateTransactionStatus).toHaveBeenCalledWith(
        "txn-1",
        TransactionStatus.BUYER_VERIFIED,
        expect.any(String),
        { autoVerified: true },
      );
      expect(transactionsService.systemUpdateTransactionStatus).toHaveBeenCalledWith(
        "txn-2",
        TransactionStatus.BUYER_VERIFIED,
        expect.any(String),
        { autoVerified: true },
      );
    });

    it("continues processing if one transaction fails", async () => {
      prisma.transaction.findMany.mockResolvedValue([
        { id: "txn-fail" } as any,
        { id: "txn-success" } as any,
      ]);

      vi.mocked(transactionsService.systemUpdateTransactionStatus).mockRejectedValueOnce(new Error("Failed"));

      await processExpiredInspections();

      expect(transactionsService.systemUpdateTransactionStatus).toHaveBeenCalledTimes(2);
    });
  });
});
