import { AccountRole, TransactionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { HttpError } from "../utils/http-error.js";

const MAX_IMAGES = 4;
const MAX_NOTE_LENGTH = 1000;
const MAX_SUBMISSIONS_PER_PARTY = 5;
// Evidence photos come from our own upload endpoint; refuse arbitrary hosts.
const ALLOWED_IMAGE_PREFIX = "https://res.cloudinary.com/";

const assertParticipantOrAdmin = async (transactionId: string, accountId: string, role: AccountRole) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, status: true, buyerId: true, sellerId: true },
  });
  if (!transaction) throw new HttpError(404, "Transaction not found");

  const isParty = transaction.buyerId === accountId || transaction.sellerId === accountId;
  if (!isParty && role !== AccountRole.ADMIN) {
    throw new HttpError(403, "You do not have access to this transaction");
  }
  return { transaction, isParty };
};

export const addDisputeEvidence = async (
  transactionId: string,
  accountId: string,
  role: AccountRole,
  input: { note?: string; imageUrls?: string[] },
) => {
  const { transaction, isParty } = await assertParticipantOrAdmin(transactionId, accountId, role);
  if (!isParty) throw new HttpError(403, "Only the buyer or seller can add evidence");

  if (transaction.status !== TransactionStatus.DISPUTED) {
    throw new HttpError(409, "Evidence can only be added while a dispute is open");
  }

  const note = input.note?.trim() ?? "";
  const imageUrls = input.imageUrls ?? [];

  if (note.length > MAX_NOTE_LENGTH) throw new HttpError(400, `Note must be ${MAX_NOTE_LENGTH} characters or fewer`);
  if (imageUrls.length > MAX_IMAGES) throw new HttpError(400, `You can attach up to ${MAX_IMAGES} photos`);
  if (imageUrls.some((u) => typeof u !== "string" || !u.startsWith(ALLOWED_IMAGE_PREFIX))) {
    throw new HttpError(400, "Invalid image URL");
  }
  if (!note && imageUrls.length === 0) throw new HttpError(400, "Add a note or at least one photo");

  const existing = await prisma.disputeEvidence.count({ where: { transactionId, submittedById: accountId } });
  if (existing >= MAX_SUBMISSIONS_PER_PARTY) {
    throw new HttpError(429, "You have reached the evidence limit for this dispute");
  }

  return prisma.disputeEvidence.create({
    data: {
      transactionId,
      submittedById: accountId,
      submitterRole: transaction.buyerId === accountId ? "BUYER" : "SELLER",
      note,
      imageUrls,
    },
  });
};

export const listDisputeEvidence = async (transactionId: string, accountId: string, role: AccountRole) => {
  await assertParticipantOrAdmin(transactionId, accountId, role);
  return prisma.disputeEvidence.findMany({
    where: { transactionId },
    orderBy: { createdAt: "asc" },
  });
};
