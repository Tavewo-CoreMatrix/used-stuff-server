import { vi, beforeEach } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Create a deep mock of PrismaClient
const prismaMock = mockDeep<PrismaClient>();

// Mock the prisma client module
vi.mock("../src/db/prisma.js", () => {
  return {
    prisma: prismaMock,
  };
});

// Expose the mock for tests to use
export const prisma = prismaMock;

beforeEach(() => {
  mockReset(prismaMock);
});
