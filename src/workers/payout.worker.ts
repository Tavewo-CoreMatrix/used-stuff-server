import { Worker } from "bullmq";
import { getRedisOptions } from "../queues/redis.js";
import { ReleasePayoutJobData } from "../queues/index.js";
import { executeSellerPayout } from "../services/payouts.service.js";

export const startPayoutWorker = () => {
  const worker = new Worker(
    "payouts",
    async (job) => {
      if (job.name !== "release-payout") {
        console.warn(`[Worker:payouts] Unknown job: ${job.name}`);
        return;
      }

      const { transactionId } = job.data as ReleasePayoutJobData;
      await executeSellerPayout(transactionId);
      console.log(`[Worker:payouts] Payout executed for tx ${transactionId}`);
    },
    { connection: getRedisOptions() },
  );

  worker.on("failed", (job, err) => {
    console.error(`[Worker:payouts] Job "${job?.name}" (${job?.id}) failed — attempt ${job?.attemptsMade}:`, err.message);
  });

  console.log("[Worker:payouts] Started");
  return worker;
};
