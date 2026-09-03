import { ListingStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { assertItemOwner } from "./items.service.js";

type CreateListingInput = {
  sellerId: string;
  itemId: string;
  price: number;
  currency?: string;
  locationCity?: string;
  status?: ListingStatus;
  quantity?: number;
  negotiable?: boolean;
  deliveryAvailable?: boolean;
  pickupAvailable?: boolean;
};

type UpdateListingInput = Partial<Omit<CreateListingInput, "sellerId" | "itemId">>;

export const createListing = async (input: CreateListingInput) => {
  await assertItemOwner(input.itemId, input.sellerId);
  const quantity = input.quantity ?? 1;

  return prisma.listing.create({
    data: {
      sellerId: input.sellerId,
      itemId: input.itemId,
      price: input.price,
      currency: input.currency ?? "NGN",
      locationCity: input.locationCity,
      status: input.status ?? ListingStatus.DRAFT,
      quantity,
      quantityAvailable: quantity,
      negotiable: input.negotiable ?? false,
      deliveryAvailable: input.deliveryAvailable ?? false,
      pickupAvailable: input.pickupAvailable ?? false,
    },
    include: listingInclude,
  });
};

type ListListingsFilters = {
  status?: ListingStatus;
  sellerId?: string;
};

export const listListings = async ({ status, sellerId }: ListListingsFilters) => {
  return prisma.listing.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(sellerId ? { sellerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: listingInclude,
  });
};

export const listMyListings = async (sellerId: string) => {
  return prisma.listing.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
    include: listingInclude,
  });
};

export const getListingById = async (listingId: string) => {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: listingInclude,
  });

  if (!listing) {
    throw new HttpError(404, "Listing not found");
  }

  return listing;
};

export const updateListing = async (listingId: string, sellerId: string, input: UpdateListingInput) => {
  const listing = await assertListingSeller(listingId, sellerId);

  const data: Record<string, unknown> = {
    price: input.price,
    currency: input.currency,
    locationCity: input.locationCity,
    status: input.status,
    negotiable: input.negotiable,
    deliveryAvailable: input.deliveryAvailable,
    pickupAvailable: input.pickupAvailable,
  };

  if (input.quantity !== undefined) {
    // Units already committed to a buyer (reserved or sold) can't be reclaimed
    // by lowering the total below what's already spoken for.
    const committed = listing.quantity - listing.quantityAvailable;
    if (input.quantity < committed) {
      throw new HttpError(400, `quantity cannot be less than ${committed} unit(s) already sold or reserved`);
    }

    const newAvailable = input.quantity - committed;
    data.quantity = input.quantity;
    data.quantityAvailable = newAvailable;

    // Auto-flip status when restocking reopens availability or a manual
    // reduction exhausts it — unless the caller explicitly set a status too.
    if (input.status === undefined) {
      if (newAvailable > 0 && listing.status === ListingStatus.RESERVED) {
        data.status = ListingStatus.ACTIVE;
      } else if (newAvailable === 0 && listing.status === ListingStatus.ACTIVE) {
        data.status = ListingStatus.RESERVED;
      }
    }
  }

  return prisma.listing.update({
    where: { id: listingId },
    data,
    include: listingInclude,
  });
};

export const deleteListing = async (listingId: string, sellerId: string) => {
  await assertListingSeller(listingId, sellerId);

  const existingTransaction = await prisma.transaction.findFirst({
    where: { listingId },
    select: { id: true },
  });

  if (existingTransaction) {
    throw new HttpError(409, "Cannot delete a listing with order history. Archive it instead.");
  }

  await prisma.listing.delete({
    where: { id: listingId },
  });
};

const assertListingSeller = async (listingId: string, sellerId: string) => {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true, status: true, quantity: true, quantityAvailable: true },
  });

  if (!listing) {
    throw new HttpError(404, "Listing not found");
  }

  if (listing.sellerId !== sellerId) {
    throw new HttpError(403, "You do not own this listing");
  }

  return listing;
};

const listingInclude = {
  item: true,
  seller: {
    select: {
      id: true,
      email: true,
      emailVerified: true,
      profile: true,
    },
  },
};
