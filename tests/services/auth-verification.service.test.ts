import { beforeEach, describe, expect, it, vi } from "vitest";
import { register, resendVerificationEmail } from "../../src/services/auth.service.js";
import { prisma } from "../setup.js";

const emailMocks = vi.hoisted(() => ({
  sendOtpEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

const passwordMocks = vi.hoisted(() => ({
  hashPassword: vi.fn(async (value: string) => `hashed:${value}`),
  verifyPassword: vi.fn(async (value: string, hash: string) => hash === `hashed:${value}`),
}));

vi.mock("../../src/utils/email.js", () => emailMocks);
vi.mock("../../src/utils/password.js", () => passwordMocks);

describe("auth email verification recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailMocks.sendOtpEmail.mockResolvedValue(undefined);
    emailMocks.sendPasswordResetEmail.mockResolvedValue(undefined);
  });

  it("re-sends verification to an existing pending account with the same password", async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: "account-1",
      emailVerified: false,
      passwordHash: "hashed:secret123",
    } as never);
    prisma.account.updateMany.mockResolvedValue({ count: 1 } as never);

    await expect(
      register({
        email: "pending@example.test",
        password: "secret123",
        profile: { displayName: "Pending User" },
      }),
    ).resolves.toEqual({
      message: "If an account is awaiting verification, a verification email will be sent when eligible.",
    });

    expect(prisma.account.updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        id: "account-1",
        emailVerified: false,
        OR: expect.any(Array),
      }),
      data: { verificationEmailSentAt: expect.any(Date) },
    });
    expect(prisma.account.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "account-1",
        emailVerified: false,
        verificationEmailSentAt: expect.any(Date),
      },
      data: expect.objectContaining({
        otpCode: expect.stringMatching(/^hashed:\d{4}$/),
        otpExpiresAt: expect.any(Date),
      }),
    });
    expect(emailMocks.sendOtpEmail).toHaveBeenCalledWith(
      "pending@example.test",
      expect.stringMatching(/^\d{4}$/),
    );
  });

  it("does not send another code during the per-account cooldown", async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: "account-1",
      emailVerified: false,
    } as never);
    prisma.account.updateMany.mockResolvedValue({ count: 0 } as never);

    await expect(resendVerificationEmail("pending@example.test")).resolves.toEqual({
      message: "If an account is awaiting verification, a verification email will be sent when eligible.",
    });
    expect(emailMocks.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("preserves the current verification code if a resend attempt fails", async () => {
    prisma.account.findUnique.mockResolvedValue({
      id: "account-1",
      emailVerified: false,
    } as never);
    prisma.account.updateMany.mockResolvedValue({ count: 1 } as never);
    emailMocks.sendOtpEmail.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(resendVerificationEmail("pending@example.test")).rejects.toMatchObject({
      statusCode: 503,
    });

    expect(prisma.account.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.account.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { verificationEmailSentAt: expect.any(Date) },
      }),
    );
  });

  it("returns the same resend response when the email has no pending account", async () => {
    prisma.account.findUnique.mockResolvedValue(null);

    await expect(resendVerificationEmail("unknown@example.test")).resolves.toEqual({
      message: "If an account is awaiting verification, a verification email will be sent when eligible.",
    });
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
    expect(emailMocks.sendOtpEmail).not.toHaveBeenCalled();
  });

  it("keeps a new account pending and reports a recoverable error if initial delivery fails", async () => {
    prisma.account.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.account.create.mockResolvedValue({
      id: "account-1",
      email: "new@example.test",
    } as never);
    emailMocks.sendOtpEmail.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      register({
        email: "new@example.test",
        password: "secret123",
        phone: "+2348000000000",
        profile: { displayName: "New User" },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("Retry registration with the same email and password"),
    });

    expect(prisma.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "new@example.test",
        verificationEmailSentAt: expect.any(Date),
      }),
      select: expect.any(Object),
    });
  });
});
