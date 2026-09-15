import { Router } from "express";
import {
  cancelWantedRequestHandler,
  createWantedRequestHandler,
  listMyWantedRequestsHandler,
} from "../controllers/wanted-requests.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const wantedRequestsRouter = Router();

wantedRequestsRouter.use(requireAuth);

wantedRequestsRouter.post("/", createWantedRequestHandler);
wantedRequestsRouter.get("/mine", listMyWantedRequestsHandler);
wantedRequestsRouter.delete("/:id", cancelWantedRequestHandler);
