import crypto from "node:crypto";
import { ListingStatus, TransactionStatus } from "@prisma/client";
import {
  schedulePendingExpiry,
  scheduleEscrowTimeout,
  scheduleInspectionDeadline,
  scheduleSellerPayout,
} from "../queues/index.js";
import { notifyTransactionParties } from "./notifications.service.js";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";

type CreateTransactionInput = {
  listingId: string;
  buyerId: string;
  paymentReference?: string;
  deliveryAddress?: Record<string, unknown>;
};

type UpdateTransactionStatusInput = {
  transactionId: string;
  accountId: string;
  toStatus: TransactionStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export const createTransaction = async (input: CreateTransactionInput) => {
  const buyer = await prisma.account.findUnique({
    where: { id: input.buyerId },
    select: { id: true },
  });

  if (!buyer) {
    throw new HttpError(404, "Buyer account not found");
  }

  // Keep the transaction lean — only writes, no heavy joins.
  // Fetch the full record after it commits.
  const newTransactionId = await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, status: true, sellerId: true, price: true, currency: true },
    });

    if (!listing) {
      throw new HttpError(404, "Listing not found");
    }

    if (listing.status !== ListingStatus.ACTIVE) {
      throw new HttpError(409, "Listing is not available for purchase");
    }

    if (listing.sellerId === input.buyerId) {
      throw new HttpError(409, "Sellers cannot buy their own listing");
    }

    const transaction = await tx.transaction.create({
      data: {
        orderNumber: createOrderNumber(),
        listingId: listing.id,
        buyerId: input.buyerId,
        sellerId: listing.sellerId,
        amount: listing.price,
        currency: listing.currency,
        status: TransactionStatus.PENDING,
        paymentReference: input.paymentReference,
        deliveryAddress: input.deliveryAddress as any,
        stateHistories: {
          create: {
            fromStatus: null,
            toStatus: TransactionStatus.PENDING,
            reason: "Buyer initiated purchase",
          },
        },
      },
      select: { id: true },
    });

    await tx.listing.update({
      where: { id: listing.id },
      data: { status: ListingStatus.RESERVED },
    });

    return transaction.id;
  });

  await scheduleJobForStatus(newTransactionId, TransactionStatus.PENDING);

  return prisma.transaction.findUniqueOrThrow({
    where: { id: newTransactionId },
    include: transactionInclude,
  });
};

export const listTransactions = async () => {
  return prisma.transaction.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: transactionInclude,
  });
};

export const listMyTransactions = async (accountId: string) => {
  return prisma.transaction.findMany({
    where: {
      OR: [{ buyerId: accountId }, { sellerId: accountId }],
    },
    orderBy: { createdAt: "desc" },
    include: transactionInclude,
  });
};

export const getTransactionById = async (transactionId: string, accountId: string, isAdmin = false) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: transactionInclude,
  });

  if (!transaction) {
    throw new HttpError(404, "Transaction not found");
  }

  if (!isAdmin && transaction.buyerId !== accountId && transaction.sellerId !== accountId) {
    throw new HttpError(403, "You do not have access to this transaction");
  }

  return transaction;
};

// Enqueues the appropriate BullMQ job after a DB status transition commits.
// Must be called OUTSIDE a Prisma $transaction block to avoid enqueueing on rollback.
const scheduleJobForStatus = async (transactionId: string, toStatus: TransactionStatus) => {
  if (toStatus === TransactionStatus.PENDING) {
    await schedulePendingExpiry(transactionId);
  } else if (toStatus === TransactionStatus.ESCROW_HELD) {
    await scheduleEscrowTimeout(transactionId);
  } else if (toStatus === TransactionStatus.SELLER_DISPATCHED) {
    await scheduleInspectionDeadline(transactionId);
  } else if (toStatus === TransactionStatus.PAYOUT_RELEASED) {
    await scheduleSellerPayout(transactionId);
  }
};

export const updateTransactionStatus = async (input: UpdateTransactionStatusInput) => {
  const updatedId = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      select: { id: true, buyerId: true, sellerId: true, status: true, listingId: true },
    });

    if (!transaction) {
      throw new HttpError(404, "Transaction not found");
    }

    if (transaction.buyerId !== input.accountId && transaction.sellerId !== input.accountId) {
      throw new HttpError(403, "You do not have access to this transaction");
    }

    assertAllowedTransition(transaction.status, input.toStatus);
    assertActorCanTransition(transaction, input.accountId, input.toStatus);

    return applyTransactionStatusUpdate(tx, transaction, input.toStatus, input.reason, input.metadata);
  });

  await scheduleJobForStatus(updatedId, input.toStatus);
  notifyTransactionParties(updatedId, input.toStatus).catch(console.error);

  return prisma.transaction.findUniqueOrThrow({
    where: { id: updatedId },
    include: transactionInclude,
  });
};

export const markSellerDispatched = async (
  transactionId: string,
  sellerId: string,
  dispatchReference?: string,
  reason?: string,
) => {
  return updateTransactionStatus({
    transactionId,
    accountId: sellerId,
    toStatus: TransactionStatus.SELLER_DISPATCHED,
    reason: reason ?? "Seller marked order as dispatched",
    metadata: dispatchReference ? { dispatchReference } : undefined,
  });
};

export const markBuyerVerified = async (transactionId: string, buyerId: string, note?: string) => {
  return updateTransactionStatus({
    transactionId,
    accountId: buyerId,
    toStatus: TransactionStatus.BUYER_VERIFIED,
    reason: note ?? "Buyer verified order delivery",
  });
};

export const openDispute = async (transactionId: string, accountId: string, disputeReason: string) => {
  return updateTransactionStatus({
    transactionId,
    accountId,
    toStatus: TransactionStatus.DISPUTED,
    reason: disputeReason,
  });
};

export const cancelTransaction = async (transactionId: string, accountId: string, reason?: string) => {
  return updateTransactionStatus({
    transactionId,
    accountId,
    toStatus: TransactionStatus.CANCELLED,
    reason: reason ?? "Transaction cancelled",
  });
};

export const releasePayout = async (transactionId: string, accountId: string, reason?: string) => {
  return updateTransactionStatus({
    transactionId,
    accountId,
    toStatus: TransactionStatus.PAYOUT_RELEASED,
    reason: reason ?? "Payout released",
  });
};

// Admin-only: resolve a disputed transaction in favour of seller (release) or buyer (cancel + refund)
export const resolveDispute = async (
  transactionId: string,
  resolution: "release" | "refund",
  adminId: string,
  reason: string,
) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, status: true, buyerId: true, sellerId: true, paymentReference: true, amount: true, currency: true },
  });

  if (!transaction) throw new HttpError(404, "Transaction not found");
  if (transaction.status !== TransactionStatus.DISPUTED) {
    throw new HttpError(409, "Transaction is not in DISPUTED state");
  }

  if (resolution === "release") {
    return systemUpdateTransactionStatus(transactionId, TransactionStatus.PAYOUT_RELEASED, `Admin resolved dispute in favour of seller: ${reason}`, { adminId, resolution });
  }

  // Refund the buyer via Paystack then cancel
  const { executeRefund } = await import("./refunds.service.js");
  return executeRefund(
    transactionId,
    transaction.paymentReference ?? "",
    Number(transaction.amount),
    transaction.currency,
    `Admin resolved dispute in favour of buyer: ${reason}`,
  );
};

/**
 * System-level transition, bypasses actor checks. Used by webhooks.
 */
export const systemUpdateTransactionStatus = async (
  transactionId: string,
  toStatus: TransactionStatus,
  reason?: string,
  metadata?: Record<string, unknown>,
) => {
  const updatedId = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, buyerId: true, sellerId: true, status: true, listingId: true },
    });

    if (!transaction) {
      throw new HttpError(404, "Transaction not found");
    }

    assertAllowedTransition(transaction.status, toStatus);

    return applyTransactionStatusUpdate(tx, transaction, toStatus, reason, metadata);
  });

  await scheduleJobForStatus(updatedId, toStatus);
  notifyTransactionParties(updatedId, toStatus).catch(console.error);

  return prisma.transaction.findUniqueOrThrow({
    where: { id: updatedId },
    include: transactionInclude,
  });
};

// Returns only the transaction ID — callers fetch the full record after the
// Prisma $transaction commits, keeping the interactive transaction lean.
const applyTransactionStatusUpdate = async (
  tx: Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">,
  transaction: { id: string; status: TransactionStatus; listingId: string },
  toStatus: TransactionStatus,
  reason?: string,
  metadata?: Record<string, unknown>,
): Promise<string> => {
  if (toStatus === TransactionStatus.PAYOUT_RELEASED) {
    await tx.listing.update({
      where: { id: transaction.listingId },
      data: { status: ListingStatus.SOLD },
    });
  } else if (toStatus === TransactionStatus.CANCELLED) {
    await tx.listing.update({
      where: { id: transaction.listingId },
      data: { status: ListingStatus.ACTIVE },
    });
  }

  const now = new Date();
  const updateData: any = { status: toStatus };

  if (toStatus === TransactionStatus.ESCROW_HELD) {
    updateData.escrowHeldAt = now;
  } else if (toStatus === TransactionStatus.SELLER_DISPATCHED) {
    updateData.sellerDispatchedAt = now;
    updateData.sellerDispatchReference =
      metadata && typeof metadata.dispatchReference === "string" ? metadata.dispatchReference : undefined;
    updateData.inspectionDeadlineAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  } else if (toStatus === TransactionStatus.BUYER_VERIFIED) {
    updateData.buyerVerifiedAt = now;
    updateData.buyerVerificationNote = reason;
  } else if (toStatus === TransactionStatus.PAYOUT_RELEASED) {
    updateData.payoutReleasedAt = now;
  } else if (toStatus === TransactionStatus.DISPUTED) {
    updateData.disputeOpenedAt = now;
    updateData.disputeReason = reason;
  } else if (toStatus === TransactionStatus.CANCELLED) {
    updateData.cancelledAt = now;
  }

  const { id } = await tx.transaction.update({
    where: { id: transaction.id },
    data: {
      ...updateData,
      stateHistories: {
        create: {
          fromStatus: transaction.status,
          toStatus: toStatus,
          reason: reason,
          metadata: metadata as any,
        },
      },
    },
    select: { id: true },
  });

  return id;
};

const assertAllowedTransition = (fromStatus: TransactionStatus, toStatus: TransactionStatus) => {
  const allowedTransitions: Record<TransactionStatus, TransactionStatus[]> = {
    PENDING: [TransactionStatus.ESCROW_HELD, TransactionStatus.CANCELLED],
    ESCROW_HELD: [TransactionStatus.SELLER_DISPATCHED, TransactionStatus.DISPUTED, TransactionStatus.CANCELLED],
    SELLER_DISPATCHED: [TransactionStatus.BUYER_VERIFIED, TransactionStatus.DISPUTED],
    BUYER_VERIFIED: [TransactionStatus.PAYOUT_RELEASED, TransactionStatus.DISPUTED],
    PAYOUT_RELEASED: [],
    // Admin resolves disputes: either release payout to seller or cancel + refund buyer
    DISPUTED: [TransactionStatus.PAYOUT_RELEASED, TransactionStatus.CANCELLED],
    CANCELLED: [],
  };

  if (!allowedTransitions[fromStatus].includes(toStatus)) {
    throw new HttpError(409, `Cannot move transaction from ${fromStatus} to ${toStatus}`);
  }
};

const assertActorCanTransition = (
  transaction: { buyerId: string; sellerId: string },
  accountId: string,
  toStatus: TransactionStatus,
) => {
  if (toStatus === TransactionStatus.SELLER_DISPATCHED && transaction.sellerId !== accountId) {
    throw new HttpError(403, "Only the seller can mark dispatch");
  }

  if (toStatus === TransactionStatus.BUYER_VERIFIED && transaction.buyerId !== accountId) {
    throw new HttpError(403, "Only the buyer can verify delivery");
  }

  if (toStatus === TransactionStatus.PAYOUT_RELEASED && transaction.buyerId !== accountId) {
    throw new HttpError(403, "Only the buyer can release payout");
  }
};

const createOrderNumber = () => {
  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `US-${datePart}-${randomPart}`;
};

const transactionInclude = {
  listing: {
    include: {
      item: true,
    },
  },
  buyer: {
    select: {
      id: true,
      email: true,
      profile: true,
    },
  },
  seller: {
    select: {
      id: true,
      email: true,
      profile: true,
    },
  },
  stateHistories: {
    orderBy: {
      createdAt: "asc" as const,
    },
  },
};
