import crypto from "node:crypto";
import { AccountRole } from "@prisma/client";
import { prisma } from "../db/prisma.js";

const generateAlias = () => `Seller-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

// Lazily assigns a stable pseudonym the first time a seller's identity needs
// to be shown to a buyer, rather than generating one for every account up
// front. Same alias every time for a given seller, but unrelated to (not
// derived from) their real id — so it can't be reverse-mapped mathematically.
export const getOrCreatePublicAlias = async (accountId: string): Promise<string> => {
  const existing = await prisma.account.findUnique({
    where: { id: accountId },
    select: { publicAlias: true },
  });

  if (existing?.publicAlias) return existing.publicAlias;

  const alias = generateAlias();
  try {
    await prisma.account.update({ where: { id: accountId }, data: { publicAlias: alias } });
    return alias;
  } catch {
    // Lost a race with a concurrent request generating one — use whatever won.
    const refetched = await prisma.account.findUnique({
      where: { id: accountId },
      select: { publicAlias: true },
    });
    return refetched?.publicAlias ?? alias;
  }
};

type SellerLike = { id: string };

/**
 * Returns `seller` unredacted only for an admin; otherwise strips it down to
 * just `{ id, profile: { displayName: alias } }` — no email, avatar, city,
 * state, country, or bio. One-directional: only ever applied to a `seller`
 * field, never to `buyer`.
 *
 * Deliberately redacts even when the viewer IS that seller: these endpoints
 * (listings, transactions) render the public/marketplace-facing view, so a
 * seller looking at their own listing should see exactly what a buyer would
 * see — not a special self-view with their real name. A seller's own real
 * identity is already available to them via their own account (/auth/me),
 * never through this embedded field.
 */
export const redactSellerForViewer = async <T extends SellerLike>(
  seller: T,
  _viewerAccountId: string | undefined,
  viewerRole: AccountRole | undefined,
): Promise<T | { id: string; profile: { displayName: string } }> => {
  if (viewerRole === AccountRole.ADMIN) {
    return seller;
  }

  const alias = await getOrCreatePublicAlias(seller.id);
  return { id: seller.id, profile: { displayName: alias } };
};
