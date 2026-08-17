import { Router } from "express";
import {
  createItemHandler,
  deleteItemHandler,
  getItemHandler,
  listItemsHandler,
  listMyItemsHandler,
  updateItemHandler,
} from "../controllers/items.controller.js";
import { uploadImageHandler } from "../controllers/upload.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

export const itemsRouter = Router();

itemsRouter.get("/", listItemsHandler);
itemsRouter.get("/mine", requireAuth, listMyItemsHandler);
itemsRouter.post("/upload-image", requireAuth, upload.single("image"), uploadImageHandler);
itemsRouter.post("/", requireAuth, createItemHandler);
itemsRouter.get("/:itemId", getItemHandler);
itemsRouter.patch("/:itemId", requireAuth, updateItemHandler);
itemsRouter.delete("/:itemId", requireAuth, deleteItemHandler);
