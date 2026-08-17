import { Router } from "express";
import { verifyImageHandler } from "../controllers/verification.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

export const verificationRouter = Router();

// Endpoint for AI verification of equipment tags. Requires authentication.
verificationRouter.post(
  "/verify-tag",
  requireAuth,
  upload.single("image"),
  verifyImageHandler
);
