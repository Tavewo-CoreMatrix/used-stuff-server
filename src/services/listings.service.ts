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
  negotiable?: boolean;
  deliveryAvailable?: boolean;
  pickupAvailable?: boolean;
};

type UpdateListingInput = Partial<Omit<CreateListingInput, "sellerId" | "itemId">>;

export const createListing = async (input: CreateListingInput) => {
  await assertItemOwner(input.itemId, input.sellerId);

  return prisma.listing.create({
    data: {
      sellerId: input.sellerId,
      itemId: input.itemId,
      price: input.price,
      currency: input.currency ?? "NGN",
      locationCity: input.locationCity,
      status: input.status ?? ListingStatus.DRAFT,
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
  await assertListingSeller(listingId, sellerId);

  return prisma.listing.update({
    where: { id: listingId },
    data: input,
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
    select: { sellerId: true },
  });

  if (!listing) {
    throw new HttpError(404, "Listing not found");
  }

  if (listing.sellerId !== sellerId) {
    throw new HttpError(403, "You do not own this listing");
  }
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
