import "dotenv/config";

const readNumber = (name: string, fallback: number) => {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: readNumber("PORT", 4000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL,
  authTokenSecret: process.env.AUTH_TOKEN_SECRET,
  authTokenExpiresInSeconds: readNumber("AUTH_TOKEN_EXPIRES_IN_SECONDS", 604_800),
  corsOrigins: corsOrigins.length > 0 ? corsOrigins : true,
  rateLimitWindowMs: readNumber("RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMaxRequests: readNumber("RATE_LIMIT_MAX_REQUESTS", 120),
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
  flutterwaveSecretHash: process.env.FLUTTERWAVE_SECRET_HASH,
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM ?? "Used Stuff <noreply@yourdomain.com>",
  otpExpiresInMinutes: readNumber("OTP_EXPIRES_IN_MINUTES", 15),
  resetTokenExpiresInMinutes: readNumber("RESET_TOKEN_EXPIRES_IN_MINUTES", 15),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  openaiApiKey: process.env.OPENAI_API_KEY,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  bullBoardUsername: process.env.BULL_BOARD_USERNAME,
  bullBoardPassword: process.env.BULL_BOARD_PASSWORD,
};

/**
 * Call once at server boot. Throws immediately if any required env var is
 * missing so the process never starts in a broken state.
 */
export const validateEnv = () => {
  const required: Array<keyof typeof env> = [
    "authTokenSecret",
    "databaseUrl",
    "paystackSecretKey",
    "resendApiKey",
    "cloudinaryCloudName",
    "cloudinaryApiKey",
    "cloudinaryApiSecret",
    "bullBoardUsername",
    "bullBoardPassword",
  ];

  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map((k) => k.replace(/([A-Z])/g, "_$1").toUpperCase()).join(", ")}`,
    );
  }

  if (env.nodeEnv === "production" && env.corsOrigins === true) {
    throw new Error("CORS_ORIGIN must be set in production — refusing to start with wildcard CORS");
  }
};
