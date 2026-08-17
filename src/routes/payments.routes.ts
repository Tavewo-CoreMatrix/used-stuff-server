import { Router } from "express";
import { flutterwaveWebhookHandler, paystackWebhookHandler } from "../controllers/payments.controller.js";

export const paymentsRouter = Router();

// Webhook endpoints must be public so the payment gateway can reach them.
// Security is handled via signature verification inside the controllers.
paymentsRouter.post("/webhook/paystack", paystackWebhookHandler);
paymentsRouter.post("/webhook/flutterwave", flutterwaveWebhookHandler);
