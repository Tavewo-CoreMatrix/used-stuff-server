import { AccountRole, AccountStatus } from "@prisma/client";
import { pageResult, readPagination } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { createAccount, getAccountById, listAccounts, updateAccountStatus } from "../services/accounts.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalString, readRouteParam, readString } from "../utils/request.js";

const readRole = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !(value in AccountRole)) {
    throw new HttpError(400, "role must be BUYER, SELLER, or ADMIN");
  }

  return value as AccountRole;
};

const readOptionalStatus = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !(value in AccountStatus)) {
    throw new HttpError(400, "status must be ACTIVE, SUSPENDED, or DELETED");
  }

  return value as AccountStatus;
};

const requireAuthContext = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};

export const createAccountHandler: RequestHandler = asyncHandler(async (request, response) => {
  const profile = request.body.profile;

  const account = await createAccount({
    email: readString(request.body.email, "email").toLowerCase(),
    phone: readOptionalString(request.body.phone),
    passwordHash: readString(request.body.passwordHash, "passwordHash"),
    role: readRole(request.body.role),
    profile:
      profile && typeof profile === "object"
        ? {
            displayName: readString(profile.displayName, "profile.displayName"),
            avatarUrl: readOptionalString(profile.avatarUrl),
            city: readOptionalString(profile.city),
            state: readOptionalString(profile.state),
            country: readOptionalString(profile.country),
          }
        : undefined,
  });

  response.status(201).json({ data: account });
});

export const getAccountHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuthContext(request);
  const targetAccountId = readRouteParam(request.params.accountId, "accountId");

  if (auth.role !== AccountRole.ADMIN && auth.accountId !== targetAccountId) {
    throw new HttpError(403, "You can only view your own account");
  }

  const account = await getAccountById(targetAccountId);

  response.json({ data: account });
});

export const listAccountsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const { limit, offset } = readPagination(request.query);
  const accounts = await listAccounts({
    status: readOptionalStatus(request.query.status),
    role: readRole(request.query.role),
    search: readOptionalString(request.query.search),
    limit,
    offset,
  });

  response.json(pageResult(accounts, limit));
});

export const updateAccountStatusHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuthContext(request);
  const targetAccountId = readRouteParam(request.params.accountId, "accountId");
  const newStatus = readOptionalStatus(request.body.status);

  if (!newStatus) {
    throw new HttpError(400, "status is required");
  }

  const reason = typeof request.body.reason === "string" ? request.body.reason : undefined;
  const account = await updateAccountStatus(targetAccountId, newStatus, auth.accountId, reason);
  response.json({ data: account });
});
