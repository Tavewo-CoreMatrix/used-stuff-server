import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { TransactionStatus } from "@prisma/client";
import { env } from "../../src/config/env.js";
import {
  confirmPaymentSync,
  processWebhookPayment,
  verifyFlutterwaveSignature,
  verifyPaystackSignature,
} from "../../src/services/payments.service.js";
import { prisma } from "../setup.js";
import * as transactionsService from "../../src/services/transactions.service.js";

// Mock env vars for tests
vi.mock("../../src/config/env.js", () => ({
  env: {
    paystackSecretKey: "test_paystack_secret",
    flutterwaveSecretHash: "test_flutterwave_hash",
  },
}));

vi.mock("../../src/services/transactions.service.js", () => ({
  systemUpdateTransactionStatus: vi.fn(),
}));

const mockVerify = vi.fn();
vi.mock("../../src/lib/paystack.js", () => ({
  getPaystack: () => ({ transaction: { verify: mockVerify } }),
}));

describe("payments.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("verifyPaystackSignature", () => {
    it("returns true for valid signature", () => {
      const rawBody = Buffer.from(JSON.stringify({ event: "charge.success" }));
      const signature = crypto
        .createHmac("sha512", "test_paystack_secret")
        .update(rawBody)
        .digest("hex");

      expect(verifyPaystackSignature(rawBody, signature)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const rawBody = Buffer.from(JSON.stringify({ event: "charge.success" }));
      expect(verifyPaystackSignature(rawBody, "invalid_signature")).toBe(false);
    });
  });

  describe("verifyFlutterwaveSignature", () => {
    it("returns true for matching hash", () => {
      expect(verifyFlutterwaveSignature("test_flutterwave_hash")).toBe(true);
    });

    it("returns false for mismatching hash", () => {
      expect(verifyFlutterwaveSignature("wrong_hash")).toBe(false);
    });
  });

  describe("processWebhookPayment", () => {
    it("ignores payment if transaction not found", async () => {
      prisma.transaction.findUnique.mockResolvedValue(null);

      await processWebhookPayment("ref-123", 1000, "NGN", "paystack");

      expect(prisma.transaction.findUnique).toHaveBeenCalledWith({
        where: { paymentReference: "ref-123" },
        select: { id: true, amount: true, currency: true, status: true },
      });
      expect(transactionsService.systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });

    it("ignores payment if transaction is not PENDING", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        amount: 1000 as any,
        currency: "NGN",
        status: TransactionStatus.ESCROW_HELD,
      } as any);

      await processWebhookPayment("ref-123", 1000, "NGN", "paystack");

      expect(transactionsService.systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });

    it("ignores payment if amount or currency mismatch", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        amount: 1000 as any,
        currency: "NGN",
        status: TransactionStatus.PENDING,
      } as any);

      // Amount mismatch
      await processWebhookPayment("ref-123", 900, "NGN", "paystack");
      // Currency mismatch
      await processWebhookPayment("ref-123", 1000, "USD", "paystack");

      expect(transactionsService.systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });

    it("transitions transaction to ESCROW_HELD on success", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        amount: 1000 as any,
        currency: "NGN",
        status: TransactionStatus.PENDING,
      } as any);

      await processWebhookPayment("ref-123", 1000, "NGN", "paystack");

      expect(transactionsService.systemUpdateTransactionStatus).toHaveBeenCalledWith(
        "txn-1",
        TransactionStatus.ESCROW_HELD,
        "Payment confirmed via webhook",
        { gateway: "paystack" },
      );
    });
  });

  describe("confirmPaymentSync", () => {
    it("throws 404 if transaction not found", async () => {
      prisma.transaction.findUnique.mockResolvedValue(null);

      await expect(confirmPaymentSync("txn-1", "buyer-1")).rejects.toThrow("Transaction not found");
    });

    it("throws 403 if the caller is not the buyer", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        amount: 1000,
        currency: "NGN",
        status: TransactionStatus.PENDING,
        paymentReference: "ref-1",
      } as any);

      await expect(confirmPaymentSync("txn-1", "stranger")).rejects.toThrow("Only the buyer can confirm this payment");
    });

    it("no-ops if already past PENDING (e.g. webhook beat it)", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        amount: 1000,
        currency: "NGN",
        status: TransactionStatus.ESCROW_HELD,
        paymentReference: "ref-1",
      } as any);

      await confirmPaymentSync("txn-1", "buyer-1");

      expect(mockVerify).not.toHaveBeenCalled();
      expect(transactionsService.systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });

    it("throws 409 if Paystack has not confirmed the charge yet", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        amount: 1000,
        currency: "NGN",
        status: TransactionStatus.PENDING,
        paymentReference: "ref-1",
      } as any);
      mockVerify.mockResolvedValue({ data: { status: "abandoned" } });

      await expect(confirmPaymentSync("txn-1", "buyer-1")).rejects.toThrow("Payment not yet confirmed by Paystack");
      expect(transactionsService.systemUpdateTransactionStatus).not.toHaveBeenCalled();
    });

    it("transitions to ESCROW_HELD once Paystack confirms success", async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        id: "txn-1",
        buyerId: "buyer-1",
        amount: 1000,
        currency: "NGN",
        status: TransactionStatus.PENDING,
        paymentReference: "ref-1",
      } as any);
      mockVerify.mockResolvedValue({ data: { status: "success", amount: 100000, currency: "NGN" } });

      await confirmPaymentSync("txn-1", "buyer-1");

      expect(mockVerify).toHaveBeenCalledWith({ reference: "ref-1" });
      expect(transactionsService.systemUpdateTransactionStatus).toHaveBeenCalledWith(
        "txn-1",
        TransactionStatus.ESCROW_HELD,
        "Payment confirmed via sync",
        { gateway: "paystack" },
      );
    });
  });
});
