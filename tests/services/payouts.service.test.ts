import { describe, expect, it, vi, beforeEach } from "vitest";
import { TransactionStatus } from "@prisma/client";
import { executeSellerPayout, handleTransferWebhook } from "../../src/services/payouts.service.js";
import { prisma } from "../setup.js";

const mockTransferRecipientCreate = vi.fn();
const mockTransferInitiate = vi.fn();

vi.mock("../../src/lib/paystack.js", () => ({
  getPaystack: () => ({
    transferrecipient: { create: mockTransferRecipientCreate },
    transfer: { initiate: mockTransferInitiate },
  }),
}));

vi.mock("../../src/services/notifications.service.js", () => ({
  notifyPayoutSettled: vi.fn(),
}));

import * as notifications from "../../src/services/notifications.service.js";

describe("payouts.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeSellerPayout", () => {
    it("throws if transaction is not found", async () => {
      prisma.transaction.findUnique.mockResolvedValue(null);

      await expect(executeSellerPayout("txn-1")).rejects.toThrow("Transaction txn-1 not found for payout");
    });

    it("throws if transaction is not PAYOUT_RELEASED", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        status: TransactionStatus.ESCROW_HELD,
        payoutTransferCode: null,
        seller: { bankAccount: {} },
      } as any);

      await expect(executeSellerPayout("txn-1")).rejects.toThrow("Transaction txn-1 is not PAYOUT_RELEASED");
    });

    it("skips if transfer was already initiated (idempotency guard)", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        status: TransactionStatus.PAYOUT_RELEASED,
        payoutTransferCode: "TRF_already_done",
        seller: { bankAccount: { accountName: "John Doe", accountNumber: "1234567890", bankCode: "044" } },
      } as any);

      await executeSellerPayout("txn-1");

      expect(mockTransferRecipientCreate).not.toHaveBeenCalled();
      expect(mockTransferInitiate).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("already initiated"));

      consoleSpy.mockRestore();
    });

    it("returns early if seller has no bank account", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        status: TransactionStatus.PAYOUT_RELEASED,
        payoutTransferCode: null,
        amount: 1000 as any,
        currency: "NGN",
        sellerId: "seller-1",
        seller: { bankAccount: null },
      } as any);

      await executeSellerPayout("txn-1");

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("has no bank account"));
      expect(mockTransferRecipientCreate).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("initiates transfer and persists transfer code", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mockTransferRecipientCreate.mockResolvedValue({ data: { recipient_code: "RCP_test123" } });
      mockTransferInitiate.mockResolvedValue({ data: { transfer_code: "TRF_test456" } });

      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        orderNumber: "ORD-001",
        status: TransactionStatus.PAYOUT_RELEASED,
        payoutTransferCode: null,
        amount: 1000 as any,
        currency: "NGN",
        sellerId: "seller-1",
        seller: {
          bankAccount: {
            accountName: "John Doe",
            accountNumber: "1234567890",
            bankCode: "044",
          },
        },
      } as any);

      await executeSellerPayout("txn-1");

      expect(mockTransferRecipientCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "John Doe", account_number: "1234567890", bank_code: "044" }),
      );
      expect(mockTransferInitiate).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: "RCP_test123", amount: 93000 }),
      );
      // Transfer code must be persisted for idempotency
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { payoutTransferCode: "TRF_test456" } }),
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Initiating ₦930 transfer"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Transfer initiated: TRF_test456"));

      consoleSpy.mockRestore();
    });
  });

  describe("handleTransferWebhook", () => {
    it("no-ops silently if transfer code does not match any transaction", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      prisma.transaction.findFirst.mockResolvedValue(null);

      await handleTransferWebhook("TRF_unknown", "transfer.success");

      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No transaction for transfer code TRF_unknown"));
      consoleSpy.mockRestore();
    });

    it("skips duplicate transfer.success webhook (already settled)", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      prisma.transaction.findFirst.mockResolvedValue({
        id: "txn-1",
        orderNumber: "ORD-001",
        payoutSettledAt: new Date("2026-07-07T00:00:00Z"),
      } as any);

      await handleTransferWebhook("TRF_test456", "transfer.success");

      expect(prisma.transaction.update).not.toHaveBeenCalled();
      expect(notifications.notifyPayoutSettled).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("already settled"));
      consoleSpy.mockRestore();
    });

    it("records payoutSettledAt and notifies seller on transfer.success", async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        id: "txn-1",
        orderNumber: "ORD-001",
        payoutSettledAt: null,
      } as any);

      await handleTransferWebhook("TRF_test456", "transfer.success");

      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "txn-1" },
          data: expect.objectContaining({ payoutSettledAt: expect.any(Date) }),
        }),
      );
      expect(notifications.notifyPayoutSettled).toHaveBeenCalledWith("txn-1");
    });

    it("records payoutFailedAt and reason on transfer.failed", async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        id: "txn-1",
        orderNumber: "ORD-001",
        listing: { item: { title: "Solar Panel" } },
      } as any);

      await handleTransferWebhook("TRF_test456", "transfer.failed", "Invalid account number");

      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "txn-1" },
          data: expect.objectContaining({
            payoutFailedAt: expect.any(Date),
            payoutFailureReason: "Invalid account number",
          }),
        }),
      );
      expect(notifications.notifyPayoutSettled).not.toHaveBeenCalled();
    });

    it("records payoutFailedAt with fallback reason on transfer.reversed", async () => {
      prisma.transaction.findFirst.mockResolvedValue({
        id: "txn-1",
        orderNumber: "ORD-001",
        listing: { item: { title: "Solar Panel" } },
      } as any);

      await handleTransferWebhook("TRF_test456", "transfer.reversed");

      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            payoutFailureReason: "transfer.reversed",
          }),
        }),
      );
    });
  });
});
