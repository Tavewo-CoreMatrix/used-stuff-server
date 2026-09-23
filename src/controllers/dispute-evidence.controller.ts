import type { RequestHandler } from "express";
import { addDisputeEvidence, listDisputeEvidence } from "../services/dispute-evidence.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalString, readRouteParam } from "../utils/request.js";

const requireAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) throw new HttpError(401, "Authentication required");
  return request.auth;
};

export const addEvidenceHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const imageUrls = request.body.imageUrls;
  if (imageUrls !== undefined && !Array.isArray(imageUrls)) {
    throw new HttpError(400, "imageUrls must be an array");
  }

  const evidence = await addDisputeEvidence(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    auth.role,
    { note: readOptionalString(request.body.note), imageUrls },
  );

  response.status(201).json({ data: evidence });
});

export const listEvidenceHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const data = await listDisputeEvidence(
    readRouteParam(request.params.transactionId, "transactionId"),
    auth.accountId,
    auth.role,
  );
  response.json({ data });
});
