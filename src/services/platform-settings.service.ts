import { prisma } from "../db/prisma.js";

// Returns the rate rounded to four decimal places, or null if it isn't acceptable.
// Clients send percent / 100, which picks up float noise (1.1 / 100 === 0.011000000000000001),
// so anything within that noise of four decimal places is accepted.
export const parseCommissionRate = (value: unknown): number | null => {
  if (typeof value !== "number") return null;
  const scaled = value * 10000;
  if (!Number.isFinite(scaled) || Math.abs(scaled - Math.round(scaled)) > 1e-6) return null;
  // A 100% rate would leave a ₦0 seller payout, which Paystack rejects.
  if (value < 0 || value >= 1) return null;
  return Math.round(scaled) / 10000;
};

export const getPlatformCommissionRate =async (): Promise<number> => {
  const settings = await prisma.platformSetting.findUniqueOrThrow({ where: { id: "global" } });
  return Number(settings.commissionRate);
};

export const updatePlatformCommissionRate = async (
  commissionRate: number,
  adminId: string,
): Promise<number> => {
  return prisma.$transaction(async (tx) => {
    const current = await tx.platformSetting.findUniqueOrThrow({ where: { id: "global" } });
    const updated = await tx.platformSetting.update({
      where: { id: "global" },
      data: { commissionRate },
    });
    const admin = await tx.account.findUniqueOrThrow({
      where: { id: adminId },
      select: { email: true },
    });
    await tx.adminAuditLog.create({
      data: {
        adminId,
        adminEmail: admin.email,
        action: "COMMISSION_RATE_CHANGED",
        targetType: "SETTING",
        targetId: "global",
        metadata: {
          previousRate: Number(current.commissionRate),
          commissionRate,
        },
      },
    });
    return Number(updated.commissionRate);
  });
};
