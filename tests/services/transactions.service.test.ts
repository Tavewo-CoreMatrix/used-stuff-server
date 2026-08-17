import { describe, expect, it, vi, beforeEach } from "vitest";
import { TransactionStatus, ListingStatus } from "@prisma/client";
import { openDispute, resolveDispute, updateTransactionStatus } from "../../src/services/transactions.service.js";
import { prisma } from "../setup.js";
import * as refundsService from "../../src/services/refunds.service.js";
import * as queues from "../../src/queues/index.js";

vi.mock("../../src/services/refunds.service.js", () => ({
  executeRefund: vi.fn().mockResolvedValue(undefined),
}));

// Schedule helpers hit real Redis via BullMQ; stub them so tests stay hermetic.
vi.mock("../../src/queues/index.js", () => ({
  scheduleEscrowTimeout: vi.fn().mockResolvedValue(undefined),
  scheduleInspectionDeadline: vi.fn().mockResolvedValue(undefined),
  scheduleSellerPayout: vi.fn().mockResolvedValue(undefined),
  scheduleRefund: vi.fn().mockResolvedValue(undefined),
}));

// Push notifications also hit external services; keep them out of unit tests.
vi.mock("../../src/services/notifications.service.js", () => ({
  notifyTransactionParties: vi.fn().mockResolvedValue(undefined),
}));

describe("transactions.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateTransactionStatus", () => {
    const mockTx = {
      transaction: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      listing: {
        update: vi.fn(),
      },
    };

    beforeEach(() => {
      // Mock the Prisma $transaction block to just execute the callback
      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });
    });

    it("throws 404 if transaction not found", async () => {
      mockTx.transaction.findUnique.mockResolvedValue(null);

      await expect(
        updateTransactionStatus({
          transactionId: "txn-1",
          accountId: "buyer-1",
          toStatus: TransactionStatus.ESCROW_HELD,
        }),
      ).rejects.toThrow("Transaction not found");
    });

    it("throws 403 if user is not buyer or seller", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        status: TransactionStatus.PENDING,
      });

      await expect(
        updateTransactionStatus({
          transactionId: "txn-1",
          accountId: "stranger",
          toStatus: TransactionStatus.ESCROW_HELD,
        }),
      ).rejects.toThrow("You do not have access to this transaction");
    });

    it("throws 409 for invalid state transition", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        status: TransactionStatus.PENDING,
      });

      // PENDING -> BUYER_VERIFIED is not allowed
      await expect(
        updateTransactionStatus({
          transactionId: "txn-1",
          accountId: "buyer-1",
          toStatus: TransactionStatus.BUYER_VERIFIED,
        }),
      ).rejects.toThrow("Cannot move transaction from PENDING to BUYER_VERIFIED");
    });

    it("throws 403 if buyer tries to dispatch", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        status: TransactionStatus.ESCROW_HELD,
      });

      await expect(
        updateTransactionStatus({
          transactionId: "txn-1",
          accountId: "buyer-1", // Buyer trying to dispatch
          toStatus: TransactionStatus.SELLER_DISPATCHED,
        }),
      ).rejects.toThrow("Only the seller can mark dispatch");
    });

    it("throws 403 if seller tries to verify", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        status: TransactionStatus.SELLER_DISPATCHED,
      });

      await expect(
        updateTransactionStatus({
          transactionId: "txn-1",
          accountId: "seller-1", // Seller trying to verify
          toStatus: TransactionStatus.BUYER_VERIFIED,
        }),
      ).rejects.toThrow("Only the buyer can verify delivery");
    });

    it("updates transaction and listing correctly on PAYOUT_RELEASED and triggers payout", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "list-1",
        status: TransactionStatus.BUYER_VERIFIED,
      });

      mockTx.transaction.update.mockResolvedValue({ id: "txn-1", status: TransactionStatus.PAYOUT_RELEASED });

      await updateTransactionStatus({
        transactionId: "txn-1",
        accountId: "buyer-1",
        toStatus: TransactionStatus.PAYOUT_RELEASED,
      });

      expect(mockTx.listing.update).toHaveBeenCalledWith({
        where: { id: "list-1" },
        data: { status: ListingStatus.SOLD },
      });
      expect(mockTx.transaction.update).toHaveBeenCalled();
      expect(queues.scheduleSellerPayout).toHaveBeenCalledWith("txn-1");
    });

    it("sets inspectionDeadlineAt when transitioning to SELLER_DISPATCHED", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "list-1",
        status: TransactionStatus.ESCROW_HELD,
      });

      mockTx.transaction.update.mockResolvedValue({ id: "txn-1", status: TransactionStatus.SELLER_DISPATCHED });

      await updateTransactionStatus({
        transactionId: "txn-1",
        accountId: "seller-1",
        toStatus: TransactionStatus.SELLER_DISPATCHED,
      });

      // Assert that update was called with inspectionDeadlineAt
      const updateCallArgs = mockTx.transaction.update.mock.calls[0][0];
      expect(updateCallArgs.data.inspectionDeadlineAt).toBeDefined();
      expect(updateCallArgs.data.sellerDispatchedAt).toBeDefined();
    });

    it("updates transaction and listing correctly on CANCELLED", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "list-1",
        status: TransactionStatus.PENDING,
      });

      mockTx.transaction.update.mockResolvedValue({ id: "txn-1", status: TransactionStatus.CANCELLED });

      await updateTransactionStatus({
        transactionId: "txn-1",
        accountId: "buyer-1",
        toStatus: TransactionStatus.CANCELLED,
      });

      expect(mockTx.listing.update).toHaveBeenCalledWith({
        where: { id: "list-1" },
        data: { status: ListingStatus.ACTIVE },
      });
      expect(mockTx.transaction.update).toHaveBeenCalled();
    });
  });

  describe("openDispute", () => {
    const mockTx = {
      transaction: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      listing: {
        update: vi.fn(),
      },
    };

    beforeEach(() => {
      prisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });
    });

    it("transitions an ESCROW_HELD transaction to DISPUTED and records the reason", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "list-1",
        status: TransactionStatus.ESCROW_HELD,
      });
      mockTx.transaction.update.mockResolvedValue({ id: "txn-1", status: TransactionStatus.DISPUTED });

      await openDispute("txn-1", "buyer-1", "Item arrived damaged");

      const updateCallArgs = mockTx.transaction.update.mock.calls[0][0];
      expect(updateCallArgs.data.status).toBe(TransactionStatus.DISPUTED);
      expect(updateCallArgs.data.disputeReason).toBe("Item arrived damaged");
      expect(updateCallArgs.data.disputeOpenedAt).toBeDefined();
    });

    it("transitions a SELLER_DISPATCHED transaction to DISPUTED", async () => {
      mockTx.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "list-1",
        status: TransactionStatus.SELLER_DISPATCHED,
      });
      mockTx.transaction.update.mockResolvedValue({ id: "txn-1", status: TransactionStatus.DISPUTED });

      await openDispute("txn-1", "seller-1", "Buyer is unresponsive");

      expect(mockTx.transaction.update).toHaveBeenCalled();
    });
  });

  describe("resolveDispute", () => {
    it("throws 404 if transaction not found", async () => {
      prisma.transaction.findUnique.mockResolvedValue(null);

      await expect(resolveDispute("txn-1", "release", "admin-1", "Evidence supports seller")).rejects.toThrow(
        "Transaction not found",
      );
    });

    it("throws 409 if transaction is not in DISPUTED state", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        status: TransactionStatus.ESCROW_HELD,
        buyerId: "buyer-1",
        sellerId: "seller-1",
        paymentReference: "ref-1",
        amount: 1000,
        currency: "NGN",
      });

      await expect(resolveDispute("txn-1", "release", "admin-1", "Evidence supports seller")).rejects.toThrow(
        "Transaction is not in DISPUTED state",
      );
    });

    describe("resolution: release", () => {
      const mockTx = {
        transaction: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        listing: {
          update: vi.fn(),
        },
      };

      beforeEach(() => {
        prisma.$transaction.mockImplementation(async (callback: any) => callback(mockTx));
      });

      it("transitions the transaction to PAYOUT_RELEASED and marks the listing SOLD", async () => {
        prisma.transaction.findUnique.mockResolvedValue({
          id: "txn-1",
          status: TransactionStatus.DISPUTED,
          buyerId: "buyer-1",
          sellerId: "seller-1",
          paymentReference: "ref-1",
          amount: 1000,
          currency: "NGN",
        });
        mockTx.transaction.findUnique.mockResolvedValue({
          id: "txn-1",
          buyerId: "buyer-1",
          sellerId: "seller-1",
          listingId: "list-1",
          status: TransactionStatus.DISPUTED,
        });
        mockTx.transaction.update.mockResolvedValue({ id: "txn-1", status: TransactionStatus.PAYOUT_RELEASED });

        await resolveDispute("txn-1", "release", "admin-1", "Evidence supports seller");

        expect(mockTx.listing.update).toHaveBeenCalledWith({
          where: { id: "list-1" },
          data: { status: ListingStatus.SOLD },
        });
        const updateCallArgs = mockTx.transaction.update.mock.calls[0][0];
        expect(updateCallArgs.data.status).toBe(TransactionStatus.PAYOUT_RELEASED);
      });
    });

    describe("resolution: refund", () => {
      it("delegates to executeRefund with the transaction's payment details", async () => {
        prisma.transaction.findUnique.mockResolvedValue({
          id: "txn-1",
          status: TransactionStatus.DISPUTED,
          buyerId: "buyer-1",
          sellerId: "seller-1",
          paymentReference: "ref-1",
          amount: 1000,
          currency: "NGN",
        });

        await resolveDispute("txn-1", "refund", "admin-1", "Item not as described");

        expect(refundsService.executeRefund).toHaveBeenCalledWith(
          "txn-1",
          "ref-1",
          1000,
          "NGN",
          expect.stringContaining("Item not as described"),
        );
      });
    });
  });
});
