import { HttpError } from "./http-error.js";

export const readString = (value: unknown, fieldName: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} is required`);
  }

  return value.trim();
};

export const readOptionalString = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "Expected a string value");
  }

  return value.trim();
};

export const readRouteParam = (value: unknown, fieldName: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${fieldName} route parameter is required`);
  }

  return value.trim();
};

export const readPositiveNumber = (value: unknown, fieldName: string) => {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive number`);
  }

  return numberValue;
};

export const readOptionalBoolean = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, "Expected a boolean value");
  }

  return value;
};

export const readOptionalObject = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
};
