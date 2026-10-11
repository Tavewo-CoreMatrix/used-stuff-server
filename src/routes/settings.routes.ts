import { Router } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { getPlatformCommissionRate } from "../services/platform-settings.service.js";

export const settingsRouter = Router();

settingsRouter.get(
  "/commission",
  asyncHandler(async (_request, response) => {
    response.json({ data: { commissionRate: await getPlatformCommissionRate() } });
  }),
);
