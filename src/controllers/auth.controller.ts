import type { RequestHandler } from "express";
import {
  deleteAccount,
  getCurrentAccount,
  login,
  register,
  verifyOtp,
  verifyCurrentPassword,
  forgotPassword,
  resetPassword,
} from "../services/auth.service.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";
import { readOptionalString, readString } from "../utils/request.js";

const readEmail = (value: unknown): string => {
  const email = readString(value, "email").toLowerCase();
  // Basic RFC-5322-like format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "email must be a valid email address");
  }
  return email;
};

const readPassword = (value: unknown) => {
  const password = readString(value, "password");

  if (password.length < 8) {
    throw new HttpError(400, "password must be at least 8 characters");
  }

  return password;
};

export const registerHandler: RequestHandler = asyncHandler(async (request, response) => {
  const profile = request.body.profile;

  const result = await register({
    email: readEmail(request.body.email),
    password: readPassword(request.body.password),
    phone: readOptionalString(request.body.phone),
    profile:
      profile && typeof profile === "object"
        ? {
            displayName: readString(profile.displayName, "profile.displayName"),
            avatarUrl: readOptionalString(profile.avatarUrl),
            city: readOptionalString(profile.city),
            state: readOptionalString(profile.state),
            country: readOptionalString(profile.country),
          }
        : undefined,
  });

  response.status(201).json({ data: result });
});

export const loginHandler: RequestHandler = asyncHandler(async (request, response) => {
  const result = await login({
    email: readEmail(request.body.email),
    password: readString(request.body.password, "password"),
  });

  response.json({ data: result });
});

export const verifyOtpHandler: RequestHandler = asyncHandler(async (request, response) => {
  const email = readEmail(request.body.email);
  const otp = readString(request.body.otp, "otp");

  const result = await verifyOtp(email, otp);
  response.json({ data: result });
});

export const forgotPasswordHandler: RequestHandler = asyncHandler(async (request, response) => {
  const email = readEmail(request.body.email);
  
  const result = await forgotPassword(email);
  response.json({ data: result });
});

export const resetPasswordHandler: RequestHandler = asyncHandler(async (request, response) => {
  const email = readEmail(request.body.email);
  const token = readString(request.body.token, "token");
  const newPassword = readPassword(request.body.newPassword);

  const result = await resetPassword(email, token, newPassword);
  response.json({ data: result });
});

export const meHandler: RequestHandler = asyncHandler(async (request, response) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  const account = await getCurrentAccount(request.auth.accountId);

  response.json({ data: account });
});

export const verifyPasswordHandler: RequestHandler = asyncHandler(async (request, response) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  const result = await verifyCurrentPassword(request.auth.accountId, readString(request.body.password, "password"));

  response.json({ data: result });
});

export const deleteAccountHandler: RequestHandler = asyncHandler(async (request, response) => {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }

  const result = await deleteAccount(request.auth.accountId);

  response.json({ data: result });
});
