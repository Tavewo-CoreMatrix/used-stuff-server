import { Router } from "express";
import {
  createListingHandler,
  deleteListingHandler,
  getListingHandler,
  listListingsHandler,
  listMyListingsHandler,
  updateListingHandler,
} from "../controllers/listings.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const listingsRouter = Router();

listingsRouter.get("/", listListingsHandler);
listingsRouter.get("/mine", requireAuth, listMyListingsHandler);
listingsRouter.post("/", requireAuth, createListingHandler);
listingsRouter.get("/:listingId", getListingHandler);
listingsRouter.patch("/:listingId", requireAuth, updateListingHandler);
listingsRouter.delete("/:listingId", requireAuth, deleteListingHandler);
