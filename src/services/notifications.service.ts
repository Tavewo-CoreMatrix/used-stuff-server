import { TransactionStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default";
};

const sendPush = async (messages: PushMessage[]): Promise<void> => {
  const valid = messages.filter((m) => m.to.startsWith("ExponentPushToken["));
  if (valid.length === 0) return;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(valid),
    });

    if (!response.ok) {
      console.error("[Notifications] Expo push API error:", response.status, await response.text());
    }
  } catch (err) {
    console.error("[Notifications] Failed to send push:", err);
  }
};

const templates: Partial<
  Record<
    TransactionStatus,
    (itemTitle: string) => { buyer?: { title: string; body: string }; seller?: { title: string; body: string } }
  >
> = {
  ESCROW_HELD: (item) => ({
    seller: {
      title: "New order received!",
      body: `Payment for "${item}" is secured in escrow. Pack and dispatch the item.`,
    },
  }),
  SELLER_DISPATCHED: (item) => ({
    buyer: {
      title: "Your item is on the way",
      body: `"${item}" has been dispatched. Confirm receipt when it arrives.`,
    },
  }),
  BUYER_VERIFIED: (item) => ({
    seller: {
      title: "Buyer confirmed receipt",
      body: `"${item}" was delivered. Your payout is being processed.`,
    },
  }),
  PAYOUT_RELEASED: (item) => ({
    seller: {
      title: "Payout released!",
      body: `Your earnings from "${item}" have been sent to your bank account.`,
    },
  }),
  DISPUTED: (item) => ({
    buyer: { title: "Dispute opened", body: `Your order for "${item}" is under review.` },
    seller: { title: "Dispute opened", body: `The buyer has raised an issue with "${item}". Open the order to add your side and photos.` },
  }),
  CANCELLED: (item) => ({
    buyer: { title: "Order cancelled", body: `Your order for "${item}" has been cancelled.` },
    seller: { title: "Order cancelled", body: `The order for "${item}" has been cancelled.` },
  }),
};

export const notifyPayoutSettled = async (transactionId: string): Promise<void> => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      listing: { select: { item: { select: { title: true } } } },
      seller: { select: { pushToken: true } },
    },
  });

  if (!transaction?.seller.pushToken) return;

  const itemTitle = transaction.listing.item.title;
  await sendPush([
    {
      to: transaction.seller.pushToken,
      sound: "default",
      title: "Money received!",
      body: `Your payment for "${itemTitle}" has arrived in your bank account.`,
      data: { transactionId, screen: "order" },
    },
  ]);
};

export const notifyWantedMatch = async (
  requesterId: string,
  listingId: string,
  itemTitle: string,
  wantedQuery: string,
): Promise<void> => {
  const requester = await prisma.account.findUnique({
    where: { id: requesterId },
    select: { pushToken: true },
  });

  if (!requester?.pushToken) return;

  await sendPush([
    {
      to: requester.pushToken,
      sound: "default",
      title: "We found it! 🔔",
      body: `"${itemTitle}" just got listed — matches your "${wantedQuery}" search.`,
      data: { listingId, screen: "product" },
    },
  ]);
};

export const notifyTransactionParties = async (
  transactionId: string,
  toStatus: TransactionStatus,
): Promise<void> => {
  const template = templates[toStatus];
  if (!template) return;

  const transaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      listing: { select: { item: { select: { title: true } } } },
      buyer: { select: { pushToken: true } },
      seller: { select: { pushToken: true } },
    },
  });

  if (!transaction) return;

  const itemTitle = transaction.listing.item.title;
  const { buyer: buyerMsg, seller: sellerMsg } = template(itemTitle);
  const data = { transactionId, screen: "order" };
  const messages: PushMessage[] = [];

  if (buyerMsg && transaction.buyer.pushToken) {
    messages.push({ to: transaction.buyer.pushToken, sound: "default", data, ...buyerMsg });
  }
  if (sellerMsg && transaction.seller.pushToken) {
    messages.push({ to: transaction.seller.pushToken, sound: "default", data, ...sellerMsg });
  }

  if (toStatus === TransactionStatus.DISPUTED) {
    const admins = await prisma.account.findMany({
      where: { role: "ADMIN", status: "ACTIVE", pushToken: { not: null } },
      select: { pushToken: true },
    });
    for (const admin of admins) {
      messages.push({
        to: admin.pushToken!,
        sound: "default",
        title: "New dispute to review",
        body: `"${itemTitle}" needs an admin decision.`,
        data: { transactionId, screen: "admin-dispute" },
      });
    }
  }

  await sendPush(messages);
};

export const notifyListingRemoved = async (accountId: string, itemTitle: string, reason: string): Promise<void> => {
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { pushToken: true } });
  if (!account?.pushToken) return;

  await sendPush([
    {
      to: account.pushToken,
      sound: "default",
      title: "Listing removed",
      body: `"${itemTitle}" was removed by our team: ${reason}`,
    },
  ]);
};
