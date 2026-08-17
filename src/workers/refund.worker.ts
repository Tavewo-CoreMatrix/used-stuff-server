import { Worker } from "bullmq";
import { getRedisOptions } from "../queues/redis.js";
import { ProcessRefundJobData } from "../queues/index.js";
import { executeRefund } from "../services/refunds.service.js";

export const startRefundWorker = () => {
  const worker = new Worker(
    "refunds",
    async (job) => {
      if (job.name !== "process-refund") {
        console.warn(`[Worker:refunds] Unknown job: ${job.name}`);
        return;
      }

      const { transactionId, paymentReference, amount, currency, reason } = job.data as ProcessRefundJobData;
      await executeRefund(transactionId, paymentReference, amount, currency, reason);
      console.log(`[Worker:refunds] Refund processed for tx ${transactionId}`);
    },
    { connection: getRedisOptions() },
  );

  worker.on("failed", (job, err) => {
    console.error(`[Worker:refunds] Job "${job?.name}" (${job?.id}) failed — attempt ${job?.attemptsMade}:`, err.message);
  });

  console.log("[Worker:refunds] Started");
  return worker;
};
