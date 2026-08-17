import { ItemCondition } from "@prisma/client";
import type { RequestHandler } from "express";
import { createItem, deleteItem, getItemById, listItems, listMyItems, updateItem } from "../services/items.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalString, readRouteParam, readString } from "../utils/request.js";

const readCondition = (value: unknown) => {
  if (typeof value !== "string" || !(value in ItemCondition)) {
    throw new HttpError(400, "condition must be NEW, LIKE_NEW, GOOD, FAIR, or POOR");
  }

  return value as ItemCondition;
};

const readOptionalCondition = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return readCondition(value);
};

const requireAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  return request.auth;
};

export const createItemHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const rawImageUrls = request.body.imageUrls;
  const imageUrls = Array.isArray(rawImageUrls) ? rawImageUrls.filter((u: unknown) => typeof u === "string") : [];
  const item = await createItem({
    ownerId: auth.accountId,
    title: readString(request.body.title, "title"),
    description: readOptionalString(request.body.description),
    category: readString(request.body.category, "category"),
    subcategory: readOptionalString(request.body.subcategory),
    brand: readOptionalString(request.body.brand),
    condition: readCondition(request.body.condition),
    imageUrls,
  });

  response.status(201).json({ data: item });
});

export const listItemsHandler: RequestHandler = asyncHandler(async (_request, response) => {
  const items = await listItems();

  response.json({ data: items });
});

export const listMyItemsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const items = await listMyItems(auth.accountId);

  response.json({ data: items });
});

export const getItemHandler: RequestHandler = asyncHandler(async (request, response) => {
  const item = await getItemById(readRouteParam(request.params.itemId, "itemId"));

  response.json({ data: item });
});

export const updateItemHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const rawImageUrls = request.body.imageUrls;
  const imageUrls = Array.isArray(rawImageUrls)
    ? rawImageUrls.filter((u: unknown) => typeof u === "string")
    : undefined;

  const item = await updateItem(readRouteParam(request.params.itemId, "itemId"), auth.accountId, {
    title: readOptionalString(request.body.title),
    description: readOptionalString(request.body.description),
    category: readOptionalString(request.body.category),
    subcategory: readOptionalString(request.body.subcategory),
    brand: readOptionalString(request.body.brand),
    condition: readOptionalCondition(request.body.condition),
    imageUrls,
  });

  response.json({ data: item });
});

export const deleteItemHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  await deleteItem(readRouteParam(request.params.itemId, "itemId"), auth.accountId);

  response.status(204).send();
});
