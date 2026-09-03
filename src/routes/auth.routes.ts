import { Router } from "express";
import {
  deleteAccountHandler,
  loginHandler,
  meHandler,
  registerHandler,
  verifyOtpHandler,
  verifyPasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const authRouter = Router();

authRouter.post("/register", registerHandler);
authRouter.post("/verify-otp", verifyOtpHandler);
authRouter.post("/login", loginHandler);
authRouter.post("/forgot-password", forgotPasswordHandler);
authRouter.post("/reset-password", resetPasswordHandler);
authRouter.get("/me", requireAuth, meHandler);
authRouter.post("/verify-password", requireAuth, verifyPasswordHandler);
authRouter.delete("/delete", requireAuth, deleteAccountHandler);
