import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";

type UpsertProfileInput = {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
  city?: string;
  state?: string;
  country?: string;
};

export const upsertProfile = async (input: UpsertProfileInput) => {
  const account = await prisma.account.findUnique({
    where: { id: input.accountId },
    select: { id: true },
  });

  if (!account) {
    throw new HttpError(404, "Account not found");
  }

  return prisma.profile.upsert({
    where: { accountId: input.accountId },
    create: input,
    update: {
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      city: input.city,
      state: input.state,
      country: input.country,
    },
  });
};
