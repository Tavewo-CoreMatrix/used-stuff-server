import { createApp } from "./app.js";
import { env, validateEnv } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { startTransactionWorker } from "./workers/transaction.worker.js";
import { startPayoutWorker } from "./workers/payout.worker.js";
import { startRefundWorker } from "./workers/refund.worker.js";

// Fail fast — better to crash at boot with a clear message than silently
// misbehave at runtime due to a missing env var.
validateEnv();

const app = createApp();

// Start all BullMQ workers
const workers = [
  startTransactionWorker(),
  startPayoutWorker(),
  startRefundWorker(),
];

const server = app.listen(env.port, env.host, () => {
  console.log(`used-stuff API listening on http://${env.host}:${env.port}`);
  console.log(`BullBoard dashboard: http://${env.host}:${env.port}/admin/queues`);
});

const shutdown = async () => {
  console.log("Shutting down...");
  server.close(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
