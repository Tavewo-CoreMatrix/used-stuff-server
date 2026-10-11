import { describe, expect, it, vi } from "vitest";
import { parseCommissionRate, updatePlatformCommissionRate } from "../../src/services/platform-settings.service.js";
import { prisma } from "../setup.js";

describe("platform-settings.service", () => {
  it("accepts every two-decimal percentage the admin screen can send", () => {
    for (let hundredths = 0; hundredths < 10000; hundredths++) {
      const percent = hundredths / 100;
      // Same conversion as the admin screen, plus the naive one older clients use.
      expect(parseCommissionRate(Math.round(percent * 100) / 10000)).toBe(hundredths / 10000);
      expect(parseCommissionRate(percent / 100)).toBe(hundredths / 10000);
    }
  });

  it("rejects 100% and above, negatives, non-numbers and extra precision", () => {
    for (const value of [1, 1.5, -0.01, 0.00005, Number.NaN, Number.POSITIVE_INFINITY, "0.07", null, undefined]) {
      expect(parseCommissionRate(value)).toBeNull();
    }
    expect(parseCommissionRate(0.9999)).toBe(0.9999);
  });

  it("updates the rate and records the change in the same transaction", async () => {
    const tx = {
      platformSetting: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ commissionRate: 0.07 }),
        update: vi.fn().mockResolvedValue({ commissionRate: 0.0875 }),
      },
      account: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ email: "admin@example.test" }),
      },
      adminAuditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await expect(updatePlatformCommissionRate(0.0875, "admin-1")).resolves.toBe(0.0875);

    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adminId: "admin-1",
        adminEmail: "admin@example.test",
        action: "COMMISSION_RATE_CHANGED",
        targetType: "SETTING",
        targetId: "global",
        metadata: { previousRate: 0.07, commissionRate: 0.0875 },
      }),
    });
  });
});
