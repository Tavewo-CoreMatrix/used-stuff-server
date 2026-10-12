ALTER TABLE "Listing"
ADD COLUMN "lastAvailabilityConfirmedAt" TIMESTAMP(3),
ADD COLUMN "lastAvailabilityReminderAt" TIMESTAMP(3);

CREATE INDEX "Listing_status_lastAvailabilityConfirmedAt_idx"
ON "Listing"("status", "lastAvailabilityConfirmedAt");

CREATE INDEX "Listing_status_lastAvailabilityReminderAt_idx"
ON "Listing"("status", "lastAvailabilityReminderAt");
