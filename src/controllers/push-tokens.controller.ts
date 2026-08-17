import { AccountRole } from "@prisma/client";
import type { RequestHandler } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readRouteParam } from "../utils/request.js";

export const updatePushTokenHandler: RequestHandler = asyncHandler(async (request, response) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");

  const targetAccountId = readRouteParam(request.params.accountId, "accountId");

  if (request.auth.role !== AccountRole.ADMIN && request.auth.accountId !== targetAccountId) {
    throw new HttpError(403, "You can only update your own push token");
  }

  const { pushToken } = request.body;
  if (typeof pushToken !== "string" && pushToken !== null) {
    throw new HttpError(400, "pushToken must be a string or null");
  }

  await prisma.account.update({
    where: { id: targetAccountId },
    data: { pushToken: pushToken ?? null },
  });

  response.json({ data: { ok: true } });
});
