import type { RequestHandler } from "express";
import {
  cancelWantedRequest,
  createWantedRequest,
  listMyWantedRequests,
} from "../services/wanted-requests.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalString, readRouteParam, readString } from "../utils/request.js";

const requireAuth = (request: Parameters<RequestHandler>[0]) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }
  return request.auth;
};

export const createWantedRequestHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);

  const wantedRequest = await createWantedRequest(
    auth.accountId,
    readString(request.body.query, "query"),
    readOptionalString(request.body.category),
    readOptionalString(request.body.subcategory),
  );

  response.status(201).json({ data: wantedRequest });
});

export const listMyWantedRequestsHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  const requests = await listMyWantedRequests(auth.accountId);
  response.json({ data: requests });
});

export const cancelWantedRequestHandler: RequestHandler = asyncHandler(async (request, response) => {
  const auth = requireAuth(request);
  await cancelWantedRequest(readRouteParam(request.params.id, "id"), auth.accountId);
  response.status(204).send();
});
