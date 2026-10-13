import { ListingStatus, TransactionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { notifyListingAvailabilityReminders } from "./notifications.service.js";

const REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export const reportListingAvailability = async (
  listingId: string,
  sellerId: string,
  remainingQuantity: number,
) => {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      quantity: true,
      quantityAvailable: true,
      removedByAdminAt: true,
      removalReason: true,
    },
  });

  if (!listing) {
    throw new HttpError(404, "Listing not found");
  }
  if (listing.sellerId !== sellerId) {
    throw new HttpError(403, "You do not own this listing");
  }
  if (listing.removedByAdminAt) {
    throw new HttpError(
      403,
      `This listing was removed by an admin${listing.removalReason ? `: ${listing.removalReason}` : ""}`,
    );
  }
  if (listing.status !== ListingStatus.ACTIVE || listing.quantityAvailable < 1) {
    throw new HttpError(409, "Only active listings with available stock can be confirmed");
  }

  if (!Number.isInteger(remainingQuantity) || remainingQuantity < 0) {
    throw new HttpError(400, "remainingQuantity must be a non-negative whole number");
  }
  if (remainingQuantity > listing.quantityAvailable) {
    throw new HttpError(
      400,
      `remainingQuantity cannot exceed the ${listing.quantityAvailable} unit(s) currently available`,
    );
  }

  if (remainingQuantity === 0) {
    const openTransaction = await prisma.transaction.findFirst({
      where: {
        listingId,
        status: {
          in: [
            TransactionStatus.PENDING,
            TransactionStatus.ESCROW_HELD,
            TransactionStatus.SELLER_DISPATCHED,
            TransactionStatus.BUYER_VERIFIED,
            TransactionStatus.DISPUTED,
          ],
        },
      },
      select: { id: true },
    });
    if (openTransaction) {
      throw new HttpError(
        409,
        "This listing has an order in progress. Resolve the order before marking the listing sold.",
      );
    }
  }

  const now = new Date();
  const updated = await prisma.listing.updateMany({
    where: {
      id: listingId,
      sellerId,
      status: ListingStatus.ACTIVE,
      quantityAvailable: listing.quantityAvailable,
      removedByAdminAt: null,
    },
    data: {
      quantity: listing.quantity - listing.quantityAvailable + remainingQuantity,
      quantityAvailable: remainingQuantity,
      status: remainingQuantity === 0 ? ListingStatus.SOLD : ListingStatus.ACTIVE,
      lastAvailabilityConfirmedAt: now,
      lastAvailabilityReminderAt: null,
    },
  });

  if (updated.count === 0) {
    throw new HttpError(409, "This listing is no longer active. Refresh your listings and try again.");
  }

  return prisma.listing.findUniqueOrThrow({
    where: { id: listingId },
    include: { item: true },
  });
};

export const processListingAvailabilityReminders = async (): Promise<{
  considered: number;
  sent: number;
}> => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - REMINDER_INTERVAL_MS);
  const availabilityDue = {
    OR: [
      { lastAvailabilityConfirmedAt: { lte: weekAgo } },
      { lastAvailabilityConfirmedAt: null, createdAt: { lte: weekAgo } },
    ],
  };
  const reminderDue = {
    OR: [
      { lastAvailabilityReminderAt: null },
      { lastAvailabilityReminderAt: { lte: weekAgo } },
    ],
  };
  const candidates = await prisma.listing.findMany({
    where: {
      status: ListingStatus.ACTIVE,
      quantityAvailable: { gt: 0 },
      removedByAdminAt: null,
      seller: {
        status: "ACTIVE",
        pushToken: { not: null },
      },
      AND: [availabilityDue, reminderDue],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sellerId: true,
      lastAvailabilityReminderAt: true,
      item: { select: { title: true } },
      seller: { select: { pushToken: true } },
    },
  });

  const claimed: typeof candidates = [];
  for (const listing of candidates) {
    if (!listing.seller.pushToken?.startsWith("ExponentPushToken[")) {
      continue;
    }

    const result = await prisma.listing.updateMany({
      where: {
        id: listing.id,
        status: ListingStatus.ACTIVE,
        quantityAvailable: { gt: 0 },
        removedByAdminAt: null,
        seller: { status: "ACTIVE", pushToken: listing.seller.pushToken },
        AND: [availabilityDue, reminderDue],
      },
      data: { lastAvailabilityReminderAt: now },
    });
    if (result.count > 0) {
      claimed.push(listing);
    }
  }

  if (claimed.length === 0) {
    return { considered: candidates.length, sent: 0 };
  }

  const acceptedListingIds = new Set(
    await notifyListingAvailabilityReminders(
      claimed.map((listing) => ({
        listingId: listing.id,
        itemTitle: listing.item.title,
        pushToken: listing.seller.pushToken!,
      })),
    ),
  );

  const failed = claimed.filter((listing) => !acceptedListingIds.has(listing.id));
  await Promise.all(
    failed.map((listing) =>
      prisma.listing.updateMany({
        where: { id: listing.id, lastAvailabilityReminderAt: now },
        data: { lastAvailabilityReminderAt: listing.lastAvailabilityReminderAt },
      }),
    ),
  );

  return { considered: candidates.length, sent: acceptedListingIds.size };
};
