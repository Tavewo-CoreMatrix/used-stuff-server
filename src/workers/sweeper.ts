import { processStaleTransactions } from "../services/refunds.service.js";
import { processListingAvailabilityReminders } from "../services/listing-availability.service.js";

const INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;
const AVAILABILITY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_FIRST_RUN_DELAY_MS = 60 * 1000;

/**
 * Safety net for abandoned checkouts and weekly listing-availability reminders.
 * The checkout timer is a delayed BullMQ job, but scheduling is best-effort:
 * if Redis is down, the sweep prevents orders from staying PENDING forever.
 * Availability reminders use persisted timestamps so restarts do not reset
 * their weekly cadence.
 *
 * Only unpaid PENDING orders are swept — no money moves. Auto-refunding paid
 * escrow orders (processAutoRefunds) is intentionally NOT enabled here.
 */
export const startSweeper = () => {
  const runAvailabilityReminders = async () => {
    try {
      const result = await processListingAvailabilityReminders();
      if (result.sent > 0) {
        console.log(`[Sweeper] Sent ${result.sent} listing availability reminder(s)`);
      }
    } catch (error) {
      console.error("[Sweeper] Listing availability reminder run failed:", error);
    }
  };

  const run = async () => {
    try {
      await processStaleTransactions();
    } catch (error) {
      console.error("[Sweeper] Stale-order sweep failed:", error);
    }
  };

  const first = setTimeout(run, FIRST_RUN_DELAY_MS);
  const interval = setInterval(run, INTERVAL_MS);
  const firstAvailabilityRun = setTimeout(runAvailabilityReminders, AVAILABILITY_FIRST_RUN_DELAY_MS);
  const availabilityInterval = setInterval(runAvailabilityReminders, AVAILABILITY_INTERVAL_MS);

  return {
    close: () => {
      clearTimeout(first);
      clearInterval(interval);
      clearTimeout(firstAvailabilityRun);
      clearInterval(availabilityInterval);
    },
  };
};
