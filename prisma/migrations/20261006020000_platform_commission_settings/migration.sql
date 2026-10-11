CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.0700,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformSetting" ("id", "commissionRate") VALUES ('global', 0.0700);

ALTER TABLE "Transaction"
ADD COLUMN "platformFeeRate" DECIMAL(5,4) NOT NULL DEFAULT 0.0700,
ADD COLUMN "platformFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00;

UPDATE "Transaction"
SET "platformFeeAmount" = ROUND("amount" * "platformFeeRate", 2);
