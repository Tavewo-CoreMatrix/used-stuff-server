import { AccountStatus, ListingStatus, TransactionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { PLATFORM_FEE_RATE } from "./payouts.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STUCK_AFTER_DAYS = 3;

// Funds Paystack has collected that haven't been paid out or refunded yet.
const IN_ESCROW: TransactionStatus[] = [
  TransactionStatus.ESCROW_HELD,
  TransactionStatus.SELLER_DISPATCHED,
  TransactionStatus.BUYER_VERIFIED,
  TransactionStatus.DISPUTED,
];

export const getAdminStats = async () => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_DAYS * DAY_MS);

  const [escrow, openDisputes, monthPayouts, allPayouts, activeListings, newAccounts, stuckOrders, failedPayouts] =
    await Promise.all([
      prisma.transaction.aggregate({ where: { status: { in: IN_ESCROW } }, _sum: { amount: true } }),
      prisma.transaction.count({ where: { status: TransactionStatus.DISPUTED } }),
      prisma.transaction.aggregate({
        where: { status: TransactionStatus.PAYOUT_RELEASED, payoutReleasedAt: { gte: monthStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { status: TransactionStatus.PAYOUT_RELEASED },
        _sum: { amount: true },
      }),
      prisma.listing.count({ where: { status: ListingStatus.ACTIVE } }),
      prisma.account.count({ where: { createdAt: { gte: weekAgo }, status: { not: AccountStatus.DELETED } } }),
      // Paid but not moving: seller hasn't dispatched, or buyer hasn't confirmed, for days.
      prisma.transaction.count({
        where: {
          status: { in: [TransactionStatus.ESCROW_HELD, TransactionStatus.SELLER_DISPATCHED, TransactionStatus.BUYER_VERIFIED] },
          updatedAt: { lt: stuckBefore },
        },
      }),
      prisma.transaction.count({
        where: { payoutFailedAt: { not: null }, payoutSettledAt: null },
      }),
    ]);

  const monthGross = Number(monthPayouts._sum.amount ?? 0);
  const lifetimeGross = Number(allPayouts._sum.amount ?? 0);

  return {
    totalEscrowHeld: Number(escrow._sum.amount ?? 0),
    openDisputes,
    payoutsReleasedThisMonth: monthPayouts._count,
    activeListings,
    newAccountsThisWeek: newAccounts,
    grossVolumeThisMonth: monthGross,
    commissionThisMonth: Math.round(monthGross * PLATFORM_FEE_RATE * 100) / 100,
    commissionLifetime: Math.round(lifetimeGross * PLATFORM_FEE_RATE * 100) / 100,
    stuckOrders,
    failedPayouts,
    commissionRate: PLATFORM_FEE_RATE,
  };
};
