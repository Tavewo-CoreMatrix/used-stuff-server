import { prisma } from "../db/prisma.js";

export type AuditAction =
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_REINSTATED"
  | "DISPUTE_RELEASED"
  | "DISPUTE_REFUNDED"
  | "ORDER_REFUNDED"
  | "ORDER_RELEASED"
  | "PAYOUT_RETRIED"
  | "LISTING_REMOVED"
  | "LISTING_RESTORED";

export const recordAuditLog = async (entry: {
  adminId: string;
  action: AuditAction;
  targetType: "ACCOUNT" | "TRANSACTION" | "LISTING";
  targetId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) => {
  const admin = await prisma.account.findUnique({ where: { id: entry.adminId }, select: { email: true } });
  return prisma.adminAuditLog.create({
    data: {
      adminId: entry.adminId,
      adminEmail: admin?.email ?? "unknown",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason,
      metadata: entry.metadata as any,
    },
  });
};

export const listAuditLogs = async (filter: { targetType?: string; targetId?: string; limit?: number }) => {
  return prisma.adminAuditLog.findMany({
    where: {
      ...(filter.targetType ? { targetType: filter.targetType } : {}),
      ...(filter.targetId ? { targetId: filter.targetId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.limit ?? 50, 200),
  });
};
