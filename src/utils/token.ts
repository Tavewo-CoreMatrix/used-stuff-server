import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "./http-error.js";

type AuthTokenPayload = {
  accountId: string;
  role: string;
  exp: number;
};

const base64UrlEncode = (value: string | Buffer) => {
  return Buffer.from(value).toString("base64url");
};

const base64UrlDecode = (value: string) => {
  return Buffer.from(value, "base64url").toString("utf8");
};

const getSecret = () => {
  if (!env.authTokenSecret || env.authTokenSecret.length < 32) {
    throw new Error("AUTH_TOKEN_SECRET must be at least 32 characters");
  }

  return env.authTokenSecret;
};

const sign = (value: string) => {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
};

export const createAuthToken = (payload: Omit<AuthTokenPayload, "exp">) => {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      exp: Math.floor(Date.now() / 1000) + env.authTokenExpiresInSeconds,
    }),
  );
  const unsignedToken = `${header}.${body}`;

  return `${unsignedToken}.${sign(unsignedToken)}`;
};

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  const [header, body, signature] = token.split(".");

  if (!header || !body || !signature) {
    throw new HttpError(401, "Invalid auth token");
  }

  const expectedSignature = sign(`${header}.${body}`);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new HttpError(401, "Invalid auth token");
  }

  const payload = JSON.parse(base64UrlDecode(body)) as AuthTokenPayload;

  if (!payload.accountId || !payload.role || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Expired auth token");
  }

  return payload;
};
