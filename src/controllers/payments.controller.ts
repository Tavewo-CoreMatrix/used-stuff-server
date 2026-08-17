import type { RequestHandler } from "express";
import { schedulePaymentConfirmation } from "../queues/index.js";
import {
  verifyFlutterwaveSignature,
  verifyPaystackSignature,
} from "../services/payments.service.js";
import { handleTransferWebhook } from "../services/payouts.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

export const paystackWebhookHandler: RequestHandler = asyncHandler(async (request, response) => {
  const signature = request.headers["x-paystack-signature"];

  if (!signature || typeof signature !== "string") {
    throw new HttpError(401, "Missing Paystack signature header");
  }

  if (!request.rawBody) {
    throw new HttpError(400, "Missing raw body for signature verification");
  }

  if (!verifyPaystackSignature(request.rawBody, signature)) {
    throw new HttpError(401, "Invalid Paystack signature");
  }

  const event = request.body;

  if (event.event === "charge.success") {
    await schedulePaymentConfirmation({
      paymentReference: event.data.reference,
      amount: event.data.amount / 100, // kobo → naira
      currency: event.data.currency,
      gateway: "paystack",
    });
  }

  if (event.event === "transfer.success") {
    await handleTransferWebhook(event.data.transfer_code, "transfer.success");
  }

  if (event.event === "transfer.failed") {
    const reason = event.data.failures?.[0]?.reason ?? "Transfer failed";
    await handleTransferWebhook(event.data.transfer_code, "transfer.failed", reason);
  }

  if (event.event === "transfer.reversed") {
    const reason = event.data.failures?.[0]?.reason ?? "Transfer reversed";
    await handleTransferWebhook(event.data.transfer_code, "transfer.reversed", reason);
  }

  // Always return 200 to acknowledge receipt of the webhook
  response.sendStatus(200);
});

export const flutterwaveWebhookHandler: RequestHandler = asyncHandler(async (request, response) => {
  const signature = request.headers["verif-hash"];

  if (!signature || typeof signature !== "string") {
    throw new HttpError(401, "Missing Flutterwave signature header");
  }

  if (!verifyFlutterwaveSignature(signature)) {
    throw new HttpError(401, "Invalid Flutterwave signature");
  }

  const event = request.body;

  if (event.event === "charge.completed" && event.data.status === "successful") {
    await schedulePaymentConfirmation({
      paymentReference: event.data.tx_ref,
      amount: event.data.amount,
      currency: event.data.currency,
      gateway: "flutterwave",
    });
  }

  // Always return 200 to acknowledge receipt of the webhook
  response.sendStatus(200);
});
