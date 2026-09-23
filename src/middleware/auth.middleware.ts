import { AccountRole, AccountStatus } from "@prisma/client";
import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { verifyAuthToken } from "../utils/token.js";

export const requireAuth: RequestHandler = async (request, _response, next) => {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return next(new HttpError(401, "Bearer token is required"));
  }

  const token = authorization.slice("Bearer ".length);
  const payload = verifyAuthToken(token);

  if (!(payload.role in AccountRole)) {
    return next(new HttpError(401, "Invalid auth token role"));
  }

  // Verify the account still exists and is active — a suspended/deleted
  // account's token must not grant access even before it expires.
  const account = await prisma.account.findUnique({
    where: { id: payload.accountId },
    select: { status: true, suspensionReason: true },
  });

  if (!account) {
    return next(new HttpError(401, "Account not found"));
  }

  if (account.status === AccountStatus.SUSPENDED) {
    return next(
      new HttpError(
        403,
        account.suspensionReason
          ? `Your account has been suspended: ${account.suspensionReason}`
          : "Your account has been suspended",
      ),
    );
  }

  if (account.status === AccountStatus.DELETED) {
    return next(new HttpError(403, "Account has been deleted"));
  }

  request.auth = {
    accountId: payload.accountId,
    role: payload.role as AccountRole,
  };

  return next();
};
