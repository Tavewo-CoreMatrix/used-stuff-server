import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notifyListingAvailabilityReminders,
  sendBroadcastNotification,
} from "../../src/services/notifications.service.js";
import { prisma } from "../setup.js";

describe("sendBroadcastNotification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("submits notifications in Expo-sized batches and skips invalid tokens", async () => {
    prisma.account.findMany.mockResolvedValue([
      ...Array.from({ length: 101 }, (_, i) => ({ pushToken: `ExponentPushToken[${i}]` })),
      { pushToken: null },
      { pushToken: "invalid-token" },
    ] as any);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)) as unknown[];
      return {
        ok: true,
        json: async () => ({ data: messages.map(() => ({ status: "ok" })) }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendBroadcastNotification("Platform update", "Hello everyone")).resolves.toEqual({
      activeParticipants: 103,
      submitted: 101,
      rejected: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends an actionable weekly listing availability reminder", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      expect(messages).toEqual([
        expect.objectContaining({
          to: "ExponentPushToken[seller]",
          title: "Is your item still available?",
          body: 'Please confirm whether "Desk" is still available for sale.',
          data: { listingId: "listing-1", screen: "listing-availability" },
        }),
      ]);
      return { ok: true, json: async () => ({ data: [{ status: "ok" }] }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      notifyListingAvailabilityReminders([
        { listingId: "listing-1", itemTitle: "Desk", pushToken: "ExponentPushToken[seller]" },
      ]),
    ).resolves.toEqual(["listing-1"]);
  });

  it("sends a token shared by several accounts only once", async () => {
    prisma.account.findMany.mockResolvedValue([
      { pushToken: "ExponentPushToken[shared]" },
      { pushToken: "ExponentPushToken[shared]" },
      { pushToken: "ExponentPushToken[other]" },
    ] as any);
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)) as unknown[];
      return { ok: true, json: async () => ({ data: messages.map(() => ({ status: "ok" })) }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendBroadcastNotification("Platform update", "Hello everyone")).resolves.toEqual({
      activeParticipants: 3,
      submitted: 2,
      rejected: 0,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toHaveLength(2);
  });

  it("reports a later batch failure as rejected instead of discarding batches already sent", async () => {
    prisma.account.findMany.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({ pushToken: `ExponentPushToken[${i}]` })) as any,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: Array.from({ length: 100 }, () => ({ status: "ok" })) }) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "temporarily unavailable" }));

    await expect(sendBroadcastNotification("Platform update", "Hello everyone")).resolves.toEqual({
      activeParticipants: 150,
      submitted: 100,
      rejected: 50,
    });
  });

  it("surfaces an Expo API failure instead of reporting success", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.account.findMany.mockResolvedValue([{ pushToken: "ExponentPushToken[valid]" }] as any);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "temporarily unavailable",
    }));

    await expect(sendBroadcastNotification("Platform update", "Hello everyone"))
      .rejects.toThrow("Expo push API returned 503: temporarily unavailable");
  });
});
