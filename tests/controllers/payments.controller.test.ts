import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createApp } from "../../src/app.js";
import * as paymentsService from "../../src/services/payments.service.js";

// Mock env vars for tests
vi.mock("../../src/config/env.js", () => ({
  env: {
    paystackSecretKey: "test_paystack_secret",
    flutterwaveSecretHash: "test_flutterwave_hash",
    corsOrigins: true,
  },
}));

// Mock the processWebhookPayment function so we don't actually hit the DB
vi.mock("../../src/services/payments.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/payments.service.js")>();
  return {
    ...actual,
    processWebhookPayment: vi.fn(),
  };
});

const app = createApp();

describe("payments.controller integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/v1/payments/webhook/paystack", () => {
    it("returns 401 if signature is missing", async () => {
      const response = await request(app).post("/api/v1/payments/webhook/paystack").send({ event: "charge.success" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Missing Paystack signature header");
    });

    it("returns 401 if signature is invalid", async () => {
      const response = await request(app)
        .post("/api/v1/payments/webhook/paystack")
        .set("x-paystack-signature", "invalid")
        .send({ event: "charge.success" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid Paystack signature");
    });

    it("returns 200 and processes valid webhook", async () => {
      const payload = {
        event: "charge.success",
        data: {
          reference: "ref-123",
          amount: 10000, // 100 NGN in kobo
          currency: "NGN",
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = crypto.createHmac("sha512", "test_paystack_secret").update(rawBody).digest("hex");

      const response = await request(app)
        .post("/api/v1/payments/webhook/paystack")
        .set("x-paystack-signature", signature)
        // Set content-type so body-parser handles it correctly
        .set("Content-Type", "application/json")
        .send(payload);

      expect(response.status).toBe(200);
      expect(paymentsService.processWebhookPayment).toHaveBeenCalledWith("ref-123", 100, "NGN", "paystack");
    });
  });

  describe("POST /api/v1/payments/webhook/flutterwave", () => {
    it("returns 401 if signature is missing", async () => {
      const response = await request(app).post("/api/v1/payments/webhook/flutterwave").send({ event: "charge.completed" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Missing Flutterwave signature header");
    });

    it("returns 401 if signature is invalid", async () => {
      const response = await request(app)
        .post("/api/v1/payments/webhook/flutterwave")
        .set("verif-hash", "invalid")
        .send({ event: "charge.completed" });

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Invalid Flutterwave signature");
    });

    it("returns 200 and processes valid webhook", async () => {
      const payload = {
        event: "charge.completed",
        data: {
          tx_ref: "fw-ref-123",
          amount: 1500,
          currency: "NGN",
          status: "successful",
        },
      };

      const response = await request(app)
        .post("/api/v1/payments/webhook/flutterwave")
        .set("verif-hash", "test_flutterwave_hash")
        .send(payload);

      expect(response.status).toBe(200);
      expect(paymentsService.processWebhookPayment).toHaveBeenCalledWith("fw-ref-123", 1500, "NGN", "flutterwave");
    });
  });
});
