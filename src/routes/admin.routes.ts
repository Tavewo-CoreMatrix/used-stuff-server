import { AccountRole } from "@prisma/client";
import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { ListingStatus } from "@prisma/client";
import {
  getAttentionOrders,
  listListingsForAdmin,
  removeListingAsAdmin,
  resolveOrderAsAdmin,
  restoreListingAsAdmin,
  type OrderResolution,
} from "../services/admin-actions.service.js";
import { listAuditLogs, recordAuditLog } from "../services/audit-log.service.js";
import { getAdminStats } from "../services/admin-stats.service.js";
import { pageResult, readPagination } from "../utils/pagination.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { parseCommissionRate, updatePlatformCommissionRate } from "../services/platform-settings.service.js";
import { sendBroadcastNotification } from "../services/notifications.service.js";

export const adminRouter = Router();

const requireAdmin: RequestHandler = (request, _response, next) => {
  if (request.auth?.role !== AccountRole.ADMIN) {
    return next(new HttpError(403, "Admin access required"));
  }
  return next();
};

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  "/stats",
  asyncHandler(async (_request, response) => {
    response.json({ data: await getAdminStats() });
  }),
);

adminRouter.patch(
  "/commission",
  asyncHandler(async (request, response) => {
    const commissionRate = parseCommissionRate(request.body?.commissionRate);
    if (commissionRate === null) {
      throw new HttpError(400, "commissionRate must be at least 0 and below 1, with at most four decimal places");
    }
    const rate = await updatePlatformCommissionRate(commissionRate, request.auth!.accountId);
    response.json({ data: { commissionRate: rate } });
  }),
);

adminRouter.post(
  "/broadcast",
  asyncHandler(async (request, response) => {
    const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
    const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
    if (!title) throw new HttpError(400, "A message title is required");
    if (!body) throw new HttpError(400, "A message body is required");
    if (title.length > 256) throw new HttpError(400, "The message title cannot exceed 256 characters");
    if (body.length > 4096) throw new HttpError(400, "The message body cannot exceed 4096 characters");
    const data = await sendBroadcastNotification(title, body);
    await recordAuditLog({
      adminId: request.auth!.accountId,
      action: "BROADCAST_SENT",
      targetType: "PLATFORM",
      targetId: "all",
      metadata: { title, body, ...data },
    });
    response.json({ data });
  }),
);

adminRouter.get(
  "/audit-log",
  asyncHandler(async (request, response) => {
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const limit = Number(request.query.limit);
    const data = await listAuditLogs({
      targetType: str(request.query.targetType),
      targetId: str(request.query.targetId),
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    response.json({ data });
  }),
);

const readParam = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new HttpError(400, `${name} is required`);
  return v;
};

const readReason = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, "A reason is required");
  return v.trim();
};

adminRouter.get(
  "/attention",
  asyncHandler(async (_request, response) => {
    response.json({ data: await getAttentionOrders() });
  }),
);

adminRouter.post(
  "/orders/:transactionId/resolve",
  asyncHandler(async (request, response) => {
    const action = request.body.action as OrderResolution;
    if (action !== "refund" && action !== "release" && action !== "retry_payout") {
      throw new HttpError(400, 'action must be "refund", "release" or "retry_payout"');
    }
    await resolveOrderAsAdmin(
      readParam(request.params.transactionId, "transactionId"),
      action,
      request.auth!.accountId,
      readReason(request.body.reason),
    );
    response.json({ data: { ok: true } });
  }),
);

adminRouter.get(
  "/listings",
  asyncHandler(async (request, response) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    if (status && !(status in ListingStatus)) throw new HttpError(400, "Invalid status");
    const search = typeof request.query.search === "string" && request.query.search.trim() ? request.query.search.trim() : undefined;
    const { limit, offset } = readPagination(request.query);
    const rows = await listListingsForAdmin({ status: status as ListingStatus | undefined, search, limit, offset });
    response.json(pageResult(rows, limit));
  }),
);

adminRouter.post(
  "/listings/:listingId/remove",
  asyncHandler(async (request, response) => {
    const data = await removeListingAsAdmin(
      readParam(request.params.listingId, "listingId"),
      request.auth!.accountId,
      readReason(request.body.reason),
    );
    response.json({ data });
  }),
);

adminRouter.post(
  "/listings/:listingId/restore",
  asyncHandler(async (request, response) => {
    const reason = typeof request.body.reason === "string" ? request.body.reason.trim() || undefined : undefined;
    const data = await restoreListingAsAdmin(readParam(request.params.listingId, "listingId"), request.auth!.accountId, reason);
    response.json({ data });
  }),
);
