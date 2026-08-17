import type { ErrorRequestHandler } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export const errorMiddleware: ErrorRequestHandler = (error, request, response, _next) => {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Internal server error";

  // Always log server errors so they are visible in the server logs.
  if (statusCode >= 500) {
    console.error(`[ERROR] ${request.method} ${request.path} — ${statusCode}:`, error);
  }

  response.status(statusCode).json({
    error: {
      message: statusCode === 500 && env.nodeEnv === "production" ? "Internal server error" : message,
      statusCode,
    },
  });
};
