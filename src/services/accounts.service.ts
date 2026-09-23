import { AccountRole, AccountStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { recordAuditLog } from "./audit-log.service.js";

type CreateAccountInput = {
  email: string;
  passwordHash: string;
  phone?: string;
  role?: AccountRole;
  profile?: {
    displayName: string;
    city?: string;
    state?: string;
    country?: string;
    avatarUrl?: string;
  };
};

export const createAccount = async (input: CreateAccountInput) => {
  const existingAccount = await prisma.account.findFirst({
    where: {
      OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])],
    },
  });

  if (existingAccount) {
    throw new HttpError(409, "Account already exists");
  }

  return prisma.account.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: input.role ?? AccountRole.BUYER,
      profile: input.profile
        ? {
            create: input.profile,
          }
        : undefined,
    },
    select: accountSelect,
  });
};

export const getAccountById = async (accountId: string) => {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: accountSelect,
  });

  if (!account) {
    throw new HttpError(404, "Account not found");
  }

  return account;
};

type ListAccountsFilter = {
  status?: AccountStatus;
  role?: AccountRole;
  search?: string;
  limit?: number;
  offset?: number;
};

// Returns up to limit + 1 rows so the caller can tell whether another page exists.
export const listAccounts = async (filter: ListAccountsFilter = {}) => {
  return prisma.account.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.search
        ? {
            OR: [
              { email: { contains: filter.search, mode: "insensitive" } },
              { profile: { displayName: { contains: filter.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: filter.offset ?? 0,
    take: (filter.limit ?? 20) + 1,
    select: accountSelect,
  });
};

export const updateAccountStatus = async (
  targetAccountId: string,
  newStatus: AccountStatus,
  adminAccountId: string,
  reason?: string,
) => {
  if (newStatus === AccountStatus.SUSPENDED && !reason?.trim()) {
    throw new HttpError(400, "A reason is required to suspend an account");
  }

  if (targetAccountId === adminAccountId) {
    throw new HttpError(400, "You cannot change your own account status");
  }

  const target = await prisma.account.findUnique({
    where: { id: targetAccountId },
    select: { id: true, role: true, status: true },
  });

  if (!target) {
    throw new HttpError(404, "Account not found");
  }

  if (target.role === AccountRole.ADMIN) {
    throw new HttpError(403, "Admin accounts cannot be suspended via this endpoint");
  }

  if (target.status === newStatus) {
    throw new HttpError(409, `Account is already ${newStatus.toLowerCase()}`);
  }

  const suspending = newStatus === AccountStatus.SUSPENDED;
  const updated = await prisma.account.update({
    where: { id: targetAccountId },
    data: {
      status: newStatus,
      suspensionReason: suspending ? reason!.trim() : null,
      suspendedAt: suspending ? new Date() : null,
    },
    select: accountSelect,
  });

  await recordAuditLog({
    adminId: adminAccountId,
    action: suspending ? "ACCOUNT_SUSPENDED" : "ACCOUNT_REINSTATED",
    targetType: "ACCOUNT",
    targetId: targetAccountId,
    reason: reason?.trim() || undefined,
    metadata: { from: target.status, to: newStatus },
  });

  return updated;
};

const accountSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerified: true,
  pushToken: true,
  profile: true,
  bankAccount: true,
  securityQuestion: true,
  suspensionReason: true,
  suspendedAt: true,
  createdAt: true,
  updatedAt: true,
};
