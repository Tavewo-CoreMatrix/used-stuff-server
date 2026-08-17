import type { RequestHandler } from "express";
import { upsertProfile } from "../services/profiles.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalString, readRouteParam, readString } from "../utils/request.js";
import { AccountRole } from "@prisma/client";

export const upsertProfileHandler: RequestHandler = asyncHandler(async (request, response) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  const targetAccountId = readRouteParam(request.params.accountId, "accountId");

  // A user can only update their own profile. Admins may update any profile.
  if (request.auth.role !== AccountRole.ADMIN && request.auth.accountId !== targetAccountId) {
    throw new HttpError(403, "You can only update your own profile");
  }

  const profile = await upsertProfile({
    accountId: targetAccountId,
    displayName: readString(request.body.displayName, "displayName"),
    avatarUrl: readOptionalString(request.body.avatarUrl),
    city: readOptionalString(request.body.city),
    state: readOptionalString(request.body.state),
    country: readOptionalString(request.body.country),
  });

  response.json({ data: profile });
});
