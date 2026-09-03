import { AccountRole, TransactionStatus } from "@prisma/client";
import type { RequestHandler } from "express";
import crypto from "node:crypto";
import {
  cancelTransaction,
  createTransaction,
  getTransactionById,
  listTransactions,
  listMyTransactions,
  markBuyerVerified,
  markSellerDispatched,
  openDispute,
  releasePayout,
  resolveDispute,
  updateTransactionStatus,
} from "../services/transactions.service.js";
import { confirmPaymentSync } from "../services/payments.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { redactSellerForViewer } from "../utils/public-seller.js";
import {
  readOptionalObject,
  readOptionalPositiveInteger,
  readOptionalString,
  readRouteParam,
  readString,
} from "../utils/request.js";

const requireAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  return request.auth;
};

// Applied to every transaction response so the buyer never sees the seller's
// real identity — only the seller themself (or an admin) sees it unredacted.
// Never applied to `buyer` — sellers still need the real buyer for delivery.
const redactTransactionSeller = async <T extends { seller: { id: string } }>(
  transaction: T,
  auth: { accountId: string; role: AccountRole },
): Promise<T> => ({
  ...transaction,
  seller: (await redactSellerForViewer(transaction.seller, auth.accountId, auth.role)) as T["seller"],
});

const readTransactionStatus = (value: unknown) => {
  if (typeof value !== "string" || !(value in TransactionStatus)) {
    throw new HttpError(
      400,
      "status must be PENDING, ESCROW_HELD, SELLER_DISPATCHED, BUYER_VERIFIED, PAYOUT_RELEASED, DISPUTED, or CANCELLED",
    );
  }

  return value as TransactionStatus;
};

export const createTransactionHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  // Use a caller-supplied reference (from mobile WebView) or generate one.
  // The mobile Paystack WebView initializes payment client-side and needs the reference
  // to match what's stored here so the webhook can find this transaction.
  const paymentReference = readOptionalString(request.body.paymentReference) || `tx_${crypto.randomUUID()}`;

  const transaction = await createTransaction({
    buyerId: auth.accountId,
    listingId: readString(request.body.listingId, "listingId"),
    quantity: readOptionalPositiveInteger(request.body.quantity),
    paymentReference,
    deliveryAddress: readOptionalObject(request.body.deliveryAddress, "deliveryAddress"),
  });

  response.status(201).json({ data: await redactTransactionSeller(transaction, auth) });
});

export const listTransactionsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);

  if (auth.role !== AccountRole.ADMIN) {
    throw new HttpError(403, "Only admins can list all transactions");
  }

  const transactions = await listTransactions();

  response.json({ data: transactions });
});

export const listMyTransactionsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transactions = await listMyTransactions(auth.accountId);

  const redacted = await Promise.all(transactions.map((transaction) => redactTransactionSeller(transaction, auth)));
  response.json({ data: redacted });
});

export const getTransactionHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transaction = await getTransactionById(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    auth.role === AccountRole.ADMIN,
  );

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const updateTransactionStatusHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const metadata = request.body.metadata;

  const transaction = await updateTransactionStatus({
    accountId: auth.accountId,
    transactionId: readRouteParam(request.params.transactionId, "transactionId"),
    toStatus: readTransactionStatus(request.body.status),
    reason: readOptionalString(request.body.reason),
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : undefined,
  });

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const markSellerDispatchedHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transaction = await markSellerDispatched(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    readOptionalString(request.body.dispatchReference),
    readOptionalString(request.body.reason),
  );

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const markBuyerVerifiedHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transaction = await markBuyerVerified(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    readOptionalString(request.body.note),
  );

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const confirmPaymentHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  await confirmPaymentSync(readRouteParam(request.params.transactionId, "transactionId"), auth.accountId);
  const transaction = await getTransactionById(readRouteParam(request.params.transactionId, "transactionId"), auth.accountId);

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const openDisputeHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transaction = await openDispute(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    readString(request.body.reason, "reason"),
  );

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const cancelTransactionHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transaction = await cancelTransaction(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    readOptionalString(request.body.reason),
  );

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const releasePayoutHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const transaction = await releasePayout(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    readOptionalString(request.body.reason),
  );

  response.json({ data: await redactTransactionSeller(transaction, auth) });
});

export const resolveDisputeHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);

  if (auth.role !== AccountRole.ADMIN) {
    throw new HttpError(403, "Only admins can resolve disputes");
  }

  const resolution = request.body.resolution;
  if (resolution !== "release" && resolution !== "refund") {
    throw new HttpError(400, 'resolution must be "release" or "refund"');
  }

  const transaction = await resolveDispute(
    readRouteParam(request.params.transactionId, "transactionId"),
    resolution,
    auth.accountId,
    readString(request.body.reason, "reason"),
  );

  response.json({ data: transaction });
});
