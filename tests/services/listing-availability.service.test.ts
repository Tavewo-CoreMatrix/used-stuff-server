import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingStatus } from "@prisma/client";
import {
  processListingAvailabilityReminders,
  reportListingAvailability,
} from "../../src/services/listing-availability.service.js";
import { prisma } from "../setup.js";

const notificationMocks = vi.hoisted(() => ({
  notifyListingAvailabilityReminders: vi.fn(),
}));

vi.mock("../../src/services/notifications.service.js", () => notificationMocks);

describe("listing availability checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMocks.notifyListingAvailabilityReminders.mockResolvedValue([]);
  });

  it("records the seller's remaining quantity and keeps the listing active", async () => {
    prisma.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      sellerId: "seller-1",
      status: ListingStatus.ACTIVE,
      quantity: 1,
      quantityAvailable: 1,
      removedByAdminAt: null,
      removalReason: null,
    } as never);
    prisma.listing.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.listing.findUniqueOrThrow.mockResolvedValue({ id: "listing-1", status: ListingStatus.ACTIVE } as never);

    await expect(reportListingAvailability("listing-1", "seller-1", 1)).resolves.toMatchObject({
      id: "listing-1",
      status: ListingStatus.ACTIVE,
    });

    expect(prisma.listing.updateMany).toHaveBeenCalledWith({
      where: {
        id: "listing-1",
        sellerId: "seller-1",
        status: ListingStatus.ACTIVE,
        quantityAvailable: 1,
        removedByAdminAt: null,
      },
      data: {
        quantity: 1,
        quantityAvailable: 1,
        status: ListingStatus.ACTIVE,
        lastAvailabilityConfirmedAt: expect.any(Date),
        lastAvailabilityReminderAt: null,
      },
    });
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });

  it("updates the total and available quantities for a partial external sale", async () => {
    prisma.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      sellerId: "seller-1",
      status: ListingStatus.ACTIVE,
      quantity: 5,
      quantityAvailable: 3,
      removedByAdminAt: null,
      removalReason: null,
    } as never);
    prisma.listing.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.listing.findUniqueOrThrow.mockResolvedValue({
      id: "listing-1",
      quantity: 4,
      quantityAvailable: 2,
      status: ListingStatus.ACTIVE,
    } as never);

    await expect(reportListingAvailability("listing-1", "seller-1", 2)).resolves.toMatchObject({
      quantity: 4,
      quantityAvailable: 2,
      status: ListingStatus.ACTIVE,
    });
    expect(prisma.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantity: 4,
          status: ListingStatus.ACTIVE,
          quantityAvailable: 2,
          lastAvailabilityConfirmedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
  });

  it("marks the listing sold when no stock remains and there are no open orders", async () => {
    prisma.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      sellerId: "seller-1",
      status: ListingStatus.ACTIVE,
      quantity: 1,
      quantityAvailable: 1,
      removedByAdminAt: null,
      removalReason: null,
    } as never);
    prisma.transaction.findFirst.mockResolvedValue(null);
    prisma.listing.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.listing.findUniqueOrThrow.mockResolvedValue({ id: "listing-1", status: ListingStatus.SOLD } as never);

    await expect(reportListingAvailability("listing-1", "seller-1", 0)).resolves.toMatchObject({
      status: ListingStatus.SOLD,
    });
    expect(prisma.listing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ListingStatus.SOLD,
          quantity: 0,
          quantityAvailable: 0,
        }),
      }),
    );
  });

  it("does not mark a listing sold while an order is in progress", async () => {
    prisma.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      sellerId: "seller-1",
      status: ListingStatus.ACTIVE,
      quantity: 1,
      quantityAvailable: 1,
      removedByAdminAt: null,
      removalReason: null,
    } as never);
    prisma.transaction.findFirst.mockResolvedValue({ id: "order-1" } as never);

    await expect(reportListingAvailability("listing-1", "seller-1", 0)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("order in progress"),
    });
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an external stock report above the current available stock", async () => {
    prisma.listing.findUnique.mockResolvedValue({
      id: "listing-1",
      sellerId: "seller-1",
      status: ListingStatus.ACTIVE,
      quantity: 4,
      quantityAvailable: 2,
      removedByAdminAt: null,
      removalReason: null,
    } as never);

    await expect(reportListingAvailability("listing-1", "seller-1", 3)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("cannot exceed"),
    });
    expect(prisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it("sends due reminders, then restores failed claims for a later retry", async () => {
    const oldReminderAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    prisma.listing.findMany.mockResolvedValue([
      {
        id: "listing-sent",
        sellerId: "seller-1",
        lastAvailabilityReminderAt: null,
        item: { title: "Desk" },
        seller: { pushToken: "ExponentPushToken[valid]" },
      },
      {
        id: "listing-failed",
        sellerId: "seller-2",
        lastAvailabilityReminderAt: oldReminderAt,
        item: { title: "Chair" },
        seller: { pushToken: "ExponentPushToken[failed]" },
      },
    ] as never);
    prisma.listing.updateMany
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    notificationMocks.notifyListingAvailabilityReminders.mockResolvedValue(["listing-sent"]);

    await expect(processListingAvailabilityReminders()).resolves.toEqual({
      considered: 2,
      sent: 1,
    });
    expect(notificationMocks.notifyListingAvailabilityReminders).toHaveBeenCalledWith([
      {
        listingId: "listing-sent",
        itemTitle: "Desk",
        pushToken: "ExponentPushToken[valid]",
      },
      {
        listingId: "listing-failed",
        itemTitle: "Chair",
        pushToken: "ExponentPushToken[failed]",
      },
    ]);
    expect(prisma.listing.updateMany).toHaveBeenLastCalledWith({
      where: { id: "listing-failed", lastAvailabilityReminderAt: expect.any(Date) },
      data: { lastAvailabilityReminderAt: oldReminderAt },
    });
  });
});
