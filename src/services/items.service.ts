import { ItemCondition } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";

type CreateItemInput = {
  ownerId: string;
  title: string;
  description?: string;
  category: string;
  subcategory?: string;
  brand?: string;
  condition: ItemCondition;
  imageUrls?: string[];
};

type UpdateItemInput = Partial<Omit<CreateItemInput, "ownerId">>;

export const createItem = async (input: CreateItemInput) => {
  return prisma.item.create({
    data: input,
    include: itemInclude,
  });
};

export const listItems = async () => {
  return prisma.item.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: itemInclude,
  });
};

export const listMyItems = async (ownerId: string) => {
  return prisma.item.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    include: itemInclude,
  });
};

export const getItemById = async (itemId: string) => {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: itemInclude,
  });

  if (!item) {
    throw new HttpError(404, "Item not found");
  }

  return item;
};

export const updateItem = async (itemId: string, ownerId: string, input: UpdateItemInput) => {
  await assertItemOwner(itemId, ownerId);

  return prisma.item.update({
    where: { id: itemId },
    data: input,
    include: itemInclude,
  });
};

export const deleteItem = async (itemId: string, ownerId: string) => {
  await assertItemOwner(itemId, ownerId);

  await prisma.item.delete({
    where: { id: itemId },
  });
};

export const assertItemOwner = async (itemId: string, ownerId: string) => {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { ownerId: true },
  });

  if (!item) {
    throw new HttpError(404, "Item not found");
  }

  if (item.ownerId !== ownerId) {
    throw new HttpError(403, "You do not own this item");
  }
};

const itemInclude = {
  owner: {
    select: {
      id: true,
      email: true,
      profile: true,
    },
  },
};
