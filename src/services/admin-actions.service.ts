import { ListingStatus, Prisma, TransactionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { recordAuditLog } from "./audit-log.service.js";
import { notifyListingRemoved } from "./notifications.service.js";
import { executeSellerPayout } from "./payouts.service.js";
import { executeRefund } from "./refunds.service.js";
import { systemUpdateTransactionStatus } from "./transactions.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const STUCK_AFTER_DAYS = 3;

const orderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  amount: true,
  currency: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
  escrowHeldAt: true,
  sellerDispatchedAt: true,
  inspectionDeadlineAt: true,
  payoutReleasedAt: true,
  payoutFailedAt: true,
  payoutFailureReason: true,
  payoutSettledAt: true,
  paymentReference: true,
  listing: { select: { id: true, item: { select: { title: true, imageUrls: true } } } },
  buyer: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
  seller: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
} satisfies Prisma.TransactionSelect;

// Orders that need an admin: paid but not moving for days, or a payout that failed.
export const getAttentionOrders = async () => {
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_DAYS * DAY_MS);

  const [stuck, failedPayouts] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        status: { in: [TransactionStatus.ESCROW_HELD, TransactionStatus.SELLER_DISPATCHED] },
        updatedAt: { lt: stuckBefore },
      },
      orderBy: { updatedAt: "asc" },
      take: 100,
      select: orderSelect,
    }),
    prisma.transaction.findMany({
      where: { payoutFailedAt: { not: null }, payoutSettledAt: null },
      orderBy: { payoutFailedAt: "desc" },
      take: 100,
      select: orderSelect,
    }),
  ]);

  return { stuck, failedPayouts };
};

export type OrderResolution = "refund" | "release" | "retry_payout";

export const resolveOrderAsAdmin = async (
  transactionId: string,
  action: OrderResolution,
  adminId: string,
  reason: string,
) => {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      paymentReference: true,
      payoutFailedAt: true,
      payoutSettledAt: true,
    },
  });
  if (!tx) throw new HttpError(404, "Order not found");

  const note = `Admin intervention: ${reason}`;

  if (action === "retry_payout") {
    if (tx.status !== TransactionStatus.PAYOUT_RELEASED || !tx.payoutFailedAt || tx.payoutSettledAt) {
      throw new HttpError(409, "This order has no failed payout to retry");
    }
    // Clear the failed transfer so the idempotency guard lets a fresh one through.
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { payoutTransferCode: null, payoutFailedAt: null, payoutFailureReason: null },
    });
    await executeSellerPayout(tx.id);
    await recordAuditLog({
      adminId, action: "PAYOUT_RETRIED", targetType: "TRANSACTION", targetId: tx.id, reason,
    });
    return;
  }

  if (action === "release") {
    if (tx.status === TransactionStatus.SELLER_DISPATCHED) {
      await systemUpdateTransactionStatus(tx.id, TransactionStatus.BUYER_VERIFIED, note, { adminId });
      await systemUpdateTransactionStatus(tx.id, TransactionStatus.PAYOUT_RELEASED, note, { adminId });
    } else if (tx.status === TransactionStatus.BUYER_VERIFIED) {
      await systemUpdateTransactionStatus(tx.id, TransactionStatus.PAYOUT_RELEASED, note, { adminId });
    } else {
      throw new HttpError(409, "Funds can only be released once the seller has dispatched the item");
    }
    await recordAuditLog({
      adminId, action: "ORDER_RELEASED", targetType: "TRANSACTION", targetId: tx.id, reason,
    });
    return;
  }

  // refund
  if (tx.status === TransactionStatus.SELLER_DISPATCHED || tx.status === TransactionStatus.BUYER_VERIFIED) {
    // The state machine only allows CANCELLED from ESCROW_HELD or DISPUTED.
    await systemUpdateTransactionStatus(tx.id, TransactionStatus.DISPUTED, note, { adminId });
  } else if (tx.status !== TransactionStatus.ESCROW_HELD) {
    throw new HttpError(409, `An order in ${tx.status} state cannot be refunded here`);
  }
  await executeRefund(tx.id, tx.paymentReference ?? "", Number(tx.amount), tx.currency, note);
  await recordAuditLog({
    adminId, action: "ORDER_REFUNDED", targetType: "TRANSACTION", targetId: tx.id, reason,
    metadata: { amount: Number(tx.amount) },
  });
};

const listingAdminInclude = {
  item: { select: { title: true, category: true, imageUrls: true, condition: true } },
  seller: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
} satisfies Prisma.ListingInclude;

export const listListingsForAdmin = async (filter: { status?: ListingStatus; search?: string; limit?: number; offset?: number }) => {
  return prisma.listing.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { item: { title: { contains: filter.search, mode: "insensitive" } } },
              { seller: { email: { contains: filter.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: filter.offset ?? 0,
    take: (filter.limit ?? 20) + 1,
    include: listingAdminInclude,
  });
};

export const removeListingAsAdmin = async (listingId: string, adminId: string, reason: string) => {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true, removedByAdminAt: true, item: { select: { title: true } } },
  });
  if (!listing) throw new HttpError(404, "Listing not found");
  if (listing.removedByAdminAt) throw new HttpError(409, "Listing is already removed");

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: { status: ListingStatus.ARCHIVED, removedByAdminAt: new Date(), removalReason: reason },
    include: listingAdminInclude,
  });

  await recordAuditLog({
    adminId, action: "LISTING_REMOVED", targetType: "LISTING", targetId: listingId, reason,
  });
  notifyListingRemoved(listing.sellerId, listing.item.title, reason).catch(console.error);

  return updated;
};

export const restoreListingAsAdmin = async (listingId: string, adminId: string, reason?: string) => {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, removedByAdminAt: true, quantityAvailable: true },
  });
  if (!listing) throw new HttpError(404, "Listing not found");
  if (!listing.removedByAdminAt) throw new HttpError(409, "Listing was not removed by an admin");

  let restoredStatus: ListingStatus = ListingStatus.ACTIVE;
  if (listing.quantityAvailable === 0) {
    // Out of stock: RESERVED while orders are still in flight, otherwise SOLD.
    const open = await prisma.transaction.count({
      where: {
        listingId,
        status: { in: [TransactionStatus.PENDING, TransactionStatus.ESCROW_HELD, TransactionStatus.SELLER_DISPATCHED, TransactionStatus.BUYER_VERIFIED, TransactionStatus.DISPUTED] },
      },
    });
    restoredStatus = open > 0 ? ListingStatus.RESERVED : ListingStatus.SOLD;
  }

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: {
      status: restoredStatus,
      removedByAdminAt: null,
      removalReason: null,
    },
    include: listingAdminInclude,
  });

  await recordAuditLog({
    adminId, action: "LISTING_RESTORED", targetType: "LISTING", targetId: listingId, reason,
  });

  return updated;
};
