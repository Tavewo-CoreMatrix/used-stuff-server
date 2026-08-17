import { createRequire } from "node:module";
import type { Paystack as PaystackType } from "@paystack/paystack-sdk";
import { env } from "../config/env.js";

// @paystack/paystack-sdk is CJS. In an ESM project, named ESM imports miss the
// constructor. createRequire loads it as CJS; the fallback chain handles packages
// that export the class as module.exports vs module.exports.Paystack vs .default.
const _require = createRequire(import.meta.url);
const _mod = _require("@paystack/paystack-sdk");
const PaystackConstructor: new (secretKey: string) => PaystackType =
  _mod?.Paystack ?? _mod?.default?.Paystack ?? _mod?.default ?? _mod;

export const getPaystack = (): PaystackType => {
  if (!env.paystackSecretKey) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return new PaystackConstructor(env.paystackSecretKey);
};
