import { AccountRole } from "@prisma/client";
import { Router } from "express";
import {
  createAccountHandler,
  getAccountHandler,
  listAccountsHandler,
  updateAccountStatusHandler,
} from "../controllers/accounts.controller.js";
import { upsertProfileHandler } from "../controllers/profiles.controller.js";
import { verifyBankAccountHandler, upsertBankAccountHandler, listBanksHandler } from "../controllers/bank-accounts.controller.js";
import { updatePushTokenHandler } from "../controllers/push-tokens.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { HttpError } from "../utils/http-error.js";
import type { RequestHandler } from "express";

export const accountsRouter = Router();

const requireAdmin: RequestHandler = (request, _response, next) => {
  if (request.auth?.role !== AccountRole.ADMIN) {
    return next(new HttpError(403, "Admin access required"));
  }
  return next();
};

// All accounts routes require authentication
accountsRouter.use(requireAuth);

accountsRouter.get("/", requireAdmin, listAccountsHandler);
accountsRouter.post("/", requireAdmin, createAccountHandler);
// Must be registered before "/:accountId" so "banks" isn't captured as an accountId.
accountsRouter.get("/banks", listBanksHandler);
accountsRouter.get("/:accountId", getAccountHandler);
accountsRouter.put("/:accountId/profile", upsertProfileHandler);
accountsRouter.get("/:accountId/bank-account/verify", verifyBankAccountHandler);
accountsRouter.put("/:accountId/bank-account", upsertBankAccountHandler);
accountsRouter.put("/:accountId/push-token", updatePushTokenHandler);
accountsRouter.patch("/:accountId/status", requireAdmin, updateAccountStatusHandler);
