import { ListingStatus } from "@prisma/client";
import type { RequestHandler } from "express";
import {
  createListing,
  deleteListing,
  getListingById,
  listListings,
  listMyListings,
  updateListing,
} from "../services/listings.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalBoolean, readOptionalString, readPositiveNumber, readRouteParam, readString } from "../utils/request.js";

const requireAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  return request.auth;
};

const readStatus = (value: unknown) => {
  if (typeof value !== "string" || !(value in ListingStatus)) {
    throw new HttpError(400, "status must be DRAFT, ACTIVE, RESERVED, SOLD, or ARCHIVED");
  }

  return value as ListingStatus;
};

const readOptionalStatus = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return readStatus(value);
};

export const createListingHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const listing = await createListing({
    sellerId: auth.accountId,
    itemId: readString(request.body.itemId, "itemId"),
    price: readPositiveNumber(request.body.price, "price"),
    currency: readOptionalString(request.body.currency),
    locationCity: readOptionalString(request.body.locationCity),
    status: readOptionalStatus(request.body.status),
    negotiable: readOptionalBoolean(request.body.negotiable),
    deliveryAvailable: readOptionalBoolean(request.body.deliveryAvailable),
    pickupAvailable: readOptionalBoolean(request.body.pickupAvailable),
  });

  response.status(201).json({ data: listing });
});

export const listListingsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const listings = await listListings(readOptionalStatus(request.query.status));

  response.json({ data: listings });
});

export const listMyListingsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const listings = await listMyListings(auth.accountId);

  response.json({ data: listings });
});

export const getListingHandler: RequestHandler = asyncHandler(async (request, response) => {
  const listing = await getListingById(readRouteParam(request.params.listingId, "listingId"));

  response.json({ data: listing });
});

export const updateListingHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const listing = await updateListing(readRouteParam(request.params.listingId, "listingId"), auth.accountId, {
    price: request.body.price === undefined ? undefined : readPositiveNumber(request.body.price, "price"),
    currency: readOptionalString(request.body.currency),
    locationCity: readOptionalString(request.body.locationCity),
    status: readOptionalStatus(request.body.status),
    negotiable: readOptionalBoolean(request.body.negotiable),
    deliveryAvailable: readOptionalBoolean(request.body.deliveryAvailable),
    pickupAvailable: readOptionalBoolean(request.body.pickupAvailable),
  });

  response.json({ data: listing });
});

export const deleteListingHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  await deleteListing(readRouteParam(request.params.listingId, "listingId"), auth.accountId);

  response.status(204).send();
});
