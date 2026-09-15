import { WantedRequestStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { fuzzySearchMatch } from "../utils/fuzzy-match.js";
import { notifyWantedMatch } from "./notifications.service.js";

export const createWantedRequest = async (
  requesterId: string,
  query: string,
  category?: string,
  subcategory?: string,
) => {
  return prisma.wantedRequest.create({
    data: { requesterId, query, category, subcategory },
  });
};

export const listMyWantedRequests = async (requesterId: string) => {
  return prisma.wantedRequest.findMany({
    where: { requesterId },
    orderBy: { createdAt: "desc" },
  });
};

export const cancelWantedRequest = async (id: string, requesterId: string) => {
  const request = await prisma.wantedRequest.findUnique({
    where: { id },
    select: { requesterId: true },
  });

  if (!request) {
    throw new HttpError(404, "Wanted request not found");
  }
  if (request.requesterId !== requesterId) {
    throw new HttpError(403, "You do not own this wanted request");
  }

  await prisma.wantedRequest.update({
    where: { id },
    data: { status: WantedRequestStatus.CANCELLED },
  });
};

/**
 * Called (fire-and-forget) right after a listing becomes ACTIVE. Finds any
 * still-open wanted requests whose search terms all appear in this listing's
 * title/category/subcategory/brand, notifies each requester once, and marks
 * that request FULFILLED so it doesn't fire again for a later listing.
 */
export const matchWantedRequests = async (listing: {
  id: string;
  item: { title: string; category: string; subcategory?: string | null; brand?: string | null };
}): Promise<void> => {
  const candidates = await prisma.wantedRequest.findMany({
    where: { status: WantedRequestStatus.ACTIVE },
    select: { id: true, requesterId: true, query: true },
  });

  if (candidates.length === 0) return;

  const searchText = [listing.item.title, listing.item.category, listing.item.subcategory, listing.item.brand]
    .filter(Boolean)
    .join(" ");

  const matches = candidates.filter((c) => fuzzySearchMatch(c.query, searchText));
  if (matches.length === 0) return;

  await Promise.all(
    matches.map(async (match) => {
      await prisma.wantedRequest.update({
        where: { id: match.id },
        data: {
          status: WantedRequestStatus.FULFILLED,
          matchedListingId: listing.id,
          fulfilledAt: new Date(),
        },
      });
      await notifyWantedMatch(match.requesterId, listing.id, listing.item.title, match.query);
    }),
  );
};
