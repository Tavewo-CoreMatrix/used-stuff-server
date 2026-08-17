import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { createAuthToken } from "../utils/token.js";
import { getAccountById } from "./accounts.service.js";
import { env } from "../config/env.js";
import { sendOtpEmail, sendPasswordResetEmail } from "../utils/email.js";
import crypto from "crypto";

type RegisterInput = {
  email: string;
  password: string;
  phone?: string;
  profile?: {
    displayName: string;
    city?: string;
    state?: string;
    country?: string;
    avatarUrl?: string;
  };
};

type LoginInput = {
  email: string;
  password: string;
};

const generateOtp = () => {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4 digits
};

const generateResetToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

export const register = async (input: RegisterInput) => {
  const existingByEmail = await prisma.account.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingByEmail) {
    throw new HttpError(409, "An account with this email already exists. Try signing in instead.");
  }

  if (input.phone) {
    const existingByPhone = await prisma.account.findUnique({
      where: { phone: input.phone },
      select: { id: true },
    });
    if (existingByPhone) {
      throw new HttpError(409, "An account with this phone number already exists.");
    }
  }

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + env.otpExpiresInMinutes * 60000);
  const hashedOtp = await hashPassword(otp);

  const account = await prisma.account.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      otpCode: hashedOtp,
      otpExpiresAt,
      profile: input.profile
        ? {
            create: input.profile,
          }
        : undefined,
    },
    select: authAccountSelect,
  });

  await sendOtpEmail(account.email, otp);

  return { message: "Account created. Please check your email for the verification code." };
};

export const verifyOtp = async (email: string, otp: string) => {
  const account = await prisma.account.findUnique({
    where: { email },
    select: { ...authAccountSelect, otpCode: true, otpExpiresAt: true, emailVerified: true },
  });

  if (!account) {
    throw new HttpError(404, "Account not found");
  }

  if (account.emailVerified) {
    throw new HttpError(400, "Email is already verified");
  }

  if (!account.otpCode || !account.otpExpiresAt || new Date(account.otpExpiresAt) < new Date()) {
    throw new HttpError(400, "OTP is expired or invalid");
  }

  if (!(await verifyPassword(otp, account.otpCode))) {
    throw new HttpError(400, "Invalid OTP");
  }

  const { otpCode: _, otpExpiresAt: __, emailVerified: ___, ...safeAccount } = account;

  const updatedAccount = await prisma.account.update({
    where: { id: account.id },
    data: { emailVerified: true, otpCode: null, otpExpiresAt: null },
    select: authAccountSelect,
  });

  return {
    account: updatedAccount,
    token: createAuthToken({ accountId: updatedAccount.id, role: updatedAccount.role }),
  };
};

export const login = async (input: LoginInput) => {
  const account = await prisma.account.findUnique({
    where: { email: input.email },
    select: {
      ...authAccountSelect,
      passwordHash: true,
      status: true,
      emailVerified: true,
    },
  });

  if (!account || !(await verifyPassword(input.password, account.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (!account.emailVerified) {
    throw new HttpError(403, "Please verify your email before logging in");
  }

  if (account.status === "SUSPENDED") {
    throw new HttpError(403, "Account is suspended");
  }

  if (account.status === "DELETED") {
    throw new HttpError(403, "Account has been deleted");
  }

  const { passwordHash: _passwordHash, ...safeAccount } = account;

  return {
    account: safeAccount,
    token: createAuthToken({ accountId: account.id, role: account.role }),
  };
};

export const forgotPassword = async (email: string) => {
  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!account) {
    return { message: "If that email is in our system, a password reset code has been sent." };
  }

  const otp = generateOtp();
  const hashedOtp = await hashPassword(otp);
  const resetTokenExpiresAt = new Date(Date.now() + env.resetTokenExpiresInMinutes * 60000);

  await prisma.account.update({
    where: { id: account.id },
    data: { resetToken: hashedOtp, resetTokenExpiresAt },
  });

  await sendPasswordResetEmail(account.email, otp);

  return { message: "If that email is in our system, a password reset code has been sent." };
};

export const resetPassword = async (email: string, token: string, newPassword: string) => {
  const account = await prisma.account.findUnique({
    where: { email },
    select: { id: true, resetToken: true, resetTokenExpiresAt: true },
  });

  if (!account || !account.resetToken || !account.resetTokenExpiresAt || new Date(account.resetTokenExpiresAt) < new Date()) {
    throw new HttpError(400, "Invalid or expired password reset token");
  }

  if (!(await verifyPassword(token, account.resetToken))) {
    throw new HttpError(400, "Invalid or expired password reset token");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.account.update({
    where: { id: account.id },
    data: { passwordHash: newPasswordHash, resetToken: null, resetTokenExpiresAt: null },
  });

  return { message: "Password has been successfully reset" };
};

export const deleteAccount = async (accountId: string) => {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { id: true, status: true },
  });

  if (!account) {
    throw new HttpError(404, "Account not found");
  }

  if (account.status === "DELETED") {
    return { message: "Account already deleted" };
  }

  await prisma.account.update({
    where: { id: accountId },
    data: {
      status: "DELETED",
      emailVerified: false,
      otpCode: null,
      otpExpiresAt: null,
      resetToken: null,
      resetTokenExpiresAt: null,
    },
  });

  return { message: "Account deleted successfully" };
};

export const getCurrentAccount = async (accountId: string) => {
  return getAccountById(accountId);
};

const authAccountSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  emailVerified: true,
  pushToken: true,
  profile: true,
  bankAccount: true,
  createdAt: true,
  updatedAt: true,
};
