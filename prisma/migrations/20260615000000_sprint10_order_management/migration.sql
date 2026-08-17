ALTER TABLE "Transaction" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "sellerDispatchReference" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "buyerVerificationNote" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "deliveryAddress" JSONB;
ALTER TABLE "Transaction" ADD COLUMN "disputeReason" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "disputeOpenedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "Transaction"
SET "orderNumber" = 'US-' || upper(substr(md5("id"), 1, 10))
WHERE "orderNumber" IS NULL;

ALTER TABLE "Transaction" ALTER COLUMN "orderNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Transaction_orderNumber_key" ON "Transaction"("orderNumber");
CREATE INDEX "Transaction_orderNumber_idx" ON "Transaction"("orderNumber");
