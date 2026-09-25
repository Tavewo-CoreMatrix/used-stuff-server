import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { deleteCloudinaryImages } from "../lib/cloudinary.js";
import { hashPassword } from "../utils/password.js";

export type ErasureMode = "deleted" | "anonymized";

/**
 * Permanently removes an account's personal data.
 *
 * - No order history: the account row is deleted outright. Profile, bank
 *   details, wanted requests, items and listings go with it (cascade).
 * - Has order history: orders reference the account with onDelete: Restrict, and
 *   the other party's purchase/payout records must stay intact, so the row cannot
 *   be removed. Instead every personal detail is erased and only an empty
 *   "Deleted user" shell remains for those records to point at.
 *
 * Callers must already have checked there are no open orders.
 */
export const eraseAccount = async (accountId: string): Promise<ErasureMode> => {
  const [orderCount, profile, items] = await Promise.all([
    prisma.transaction.count({ where: { OR: [{ buyerId: accountId }, { sellerId: accountId }] } }),
    prisma.profile.findUnique({ where: { accountId }, select: { avatarUrl: true } }),
    prisma.item.findMany({
      where: { ownerId: accountId },
      select: {
        id: true,
        imageUrls: true,
        listings: { select: { _count: { select: { transactions: true } } } },
      },
    }),
  ]);

  const hasOrders = (item: (typeof items)[number]) => item.listings.some((l) => l._count.transactions > 0);
  const avatar = profile?.avatarUrl ? [profile.avatarUrl] : [];

  if (orderCount === 0) {
    const images = [...avatar, ...items.flatMap((i) => i.imageUrls)];
    await prisma.account.delete({ where: { id: accountId } });
    await deleteCloudinaryImages(images);
    return "deleted";
  }

  // Items that were part of an order stay (the other party's order history shows
  // them); everything else the account created is deleted.
  const removableItems = items.filter((i) => !hasOrders(i));
  const unusablePassword = await hashPassword(crypto.randomBytes(32).toString("hex"));

  await prisma.$transaction([
    prisma.wantedRequest.deleteMany({ where: { requesterId: accountId } }),
    prisma.bankAccount.deleteMany({ where: { accountId } }),
    prisma.profile.deleteMany({ where: { accountId } }),
    prisma.item.deleteMany({ where: { id: { in: removableItems.map((i) => i.id) } } }),
    prisma.listing.updateMany({ where: { sellerId: accountId }, data: { status: "ARCHIVED" } }),
    prisma.profile.create({ data: { accountId, displayName: "Deleted user", country: null } }),
    prisma.account.update({
      where: { id: accountId },
      data: {
        status: "DELETED",
        // Unique placeholders: frees the real email/phone for re-registration.
        email: `deleted-${accountId}@deleted.invalid`,
        phone: null,
        passwordHash: unusablePassword,
        emailVerified: false,
        pushToken: null,
        otpCode: null,
        otpExpiresAt: null,
        resetToken: null,
        resetTokenExpiresAt: null,
        securityQuestion: null,
        securityAnswerHash: null,
        suspensionReason: null,
        suspendedAt: null,
      },
    }),
  ]);

  await deleteCloudinaryImages([...avatar, ...removableItems.flatMap((i) => i.imageUrls)]);
  return "anonymized";
};
