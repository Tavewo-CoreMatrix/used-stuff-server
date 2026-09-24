import { processStaleTransactions } from "../services/refunds.service.js";

const INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;

/**
 * Safety net for abandoned checkouts. The normal path is a delayed BullMQ job
 * scheduled at checkout, but that job is best-effort: if Redis is down or over
 * quota at that moment the schedule call fails (by design, so checkout still
 * works) and the order would otherwise sit PENDING forever, holding stock and
 * blocking account deletion. This sweep needs no Redis, so it always runs.
 *
 * Only unpaid PENDING orders are swept — no money moves. Auto-refunding paid
 * escrow orders (processAutoRefunds) is intentionally NOT enabled here.
 */
export const startSweeper = () => {
  const run = async () => {
    try {
      await processStaleTransactions();
    } catch (error) {
      console.error("[Sweeper] Stale-order sweep failed:", error);
    }
  };

  const first = setTimeout(run, FIRST_RUN_DELAY_MS);
  const interval = setInterval(run, INTERVAL_MS);

  return {
    close: () => {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
};
