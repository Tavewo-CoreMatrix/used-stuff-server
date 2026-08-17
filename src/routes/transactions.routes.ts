import { Router } from "express";
import {
  cancelTransactionHandler,
  confirmPaymentHandler,
  createTransactionHandler,
  getTransactionHandler,
  listTransactionsHandler,
  listMyTransactionsHandler,
  markBuyerVerifiedHandler,
  markSellerDispatchedHandler,
  openDisputeHandler,
  releasePayoutHandler,
  resolveDisputeHandler,
  updateTransactionStatusHandler,
} from "../controllers/transactions.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.get("/", listTransactionsHandler);
transactionsRouter.get("/mine", listMyTransactionsHandler);
transactionsRouter.post("/", createTransactionHandler);
transactionsRouter.get("/:transactionId", getTransactionHandler);
transactionsRouter.patch("/:transactionId/status", updateTransactionStatusHandler);
transactionsRouter.post("/:transactionId/dispatch", markSellerDispatchedHandler);
transactionsRouter.post("/:transactionId/verify-delivery", markBuyerVerifiedHandler);
transactionsRouter.post("/:transactionId/dispute", openDisputeHandler);
transactionsRouter.post("/:transactionId/cancel", cancelTransactionHandler);
transactionsRouter.post("/:transactionId/release-payout", releasePayoutHandler);
transactionsRouter.post("/:transactionId/resolve-dispute", resolveDisputeHandler);
transactionsRouter.post("/:transactionId/confirm-payment", confirmPaymentHandler);
