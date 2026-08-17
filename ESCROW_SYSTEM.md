# Option B: Proper Escrow System

## Overview

This backend implements **Option B escrow**, a secure payment flow where funds are held in escrow until the seller fulfills their obligation. Paystack processes payments, and our system controls fund release timing.

## Payment Flow

### 1. **PENDING** (User initiates purchase)
```
POST /api/v1/transactions
├─ Creates transaction in PENDING state
├─ Reserves listing
└─ Returns Paystack authorization URL
```

### 2. **Payment & Webhook** (Paystack processes payment)
```
User opens Paystack checkout
├─ Completes payment
└─ Paystack sends webhook to POST /api/v1/payments/webhook/paystack

Backend receives webhook:
├─ Verifies signature
├─ Validates amount & currency match transaction
└─ Transitions to ESCROW_HELD (funds are "held")
```

**State: ESCROW_HELD**
- Amount captured by Paystack
- Funds NOT yet transferred to seller
- 7-day countdown starts for seller to dispatch

### 3. **Seller Dispatch** (Seller sends product)
```
POST /api/v1/transactions/:transactionId/dispatch
├─ Only seller can call this
├─ Sets inspectionDeadlineAt = now + 48 hours
└─ Transitions to SELLER_DISPATCHED
```

**State: SELLER_DISPATCHED**
- Product is on its way
- Buyer has 48 hours to verify delivery
- If no action: auto-verifies after 48 hours (inspection-cron)

### 4. **Buyer Verification** (Buyer confirms receipt)
```
POST /api/v1/transactions/:transactionId/verify-delivery
├─ Only buyer can call this
├─ Requires delivery confirmation note
└─ Transitions to BUYER_VERIFIED
```

**State: BUYER_VERIFIED**
- Delivery confirmed
- Payout can now be released
- Seller awaits buyer to release payout

### 5. **Payout Release** (Buyer releases funds to seller)
```
POST /api/v1/transactions/:transactionId/release-payout
├─ Only buyer can call this
├─ Triggers executeSellerPayout() async
└─ Transitions to PAYOUT_RELEASED
```

**State: PAYOUT_RELEASED**
- Funds transferred from Paystack to seller's bank account
- Platform takes ~5% fee
- Seller receives remainder

---

## Automatic Timeouts

### 48-Hour Inspection Timeout
**Cron: Every hour**
```
if (transaction.status === SELLER_DISPATCHED && inspectionDeadlineAt < now)
  ├─ Auto-transition to BUYER_VERIFIED
  └─ Trigger payout release eligibility
```

### 7-Day Escrow Timeout (AUTO-REFUND)
**Cron: Daily at 2 AM UTC**
```
if (transaction.status === ESCROW_HELD && escrowHeldAt < (now - 7 days))
  ├─ Call Paystack refund API
  ├─ Return funds to buyer
  └─ Transition to CANCELLED with refund metadata
```

---

## Dispute & Cancellation

### Buyer initiates dispute
```
POST /api/v1/transactions/:transactionId/dispute?reason=...
├─ Freezes transaction at current state
└─ Transitions to DISPUTED
```

State: **DISPUTED**
- No further automatic actions
- Manual intervention required
- Support team reviews & decides refund/release

### Cancellation (Early termination)
```
POST /api/v1/transactions/:transactionId/cancel?reason=...
├─ Valid in PENDING and ESCROW_HELD
└─ Transitions to CANCELLED
```

---

## Fund Hold Model

```
┌─────────────────────────────────────────────────┐
│ User pays via Paystack                          │
│ Amount: NGN 50,000                              │
└──────────────┬──────────────────────────────────┘
               │
               ▼ (WEBHOOK RECEIVED)
        ┌──────────────────┐
        │  ESCROW_HELD     │
        │  (0 - 7 days)    │
        │  Funds trapped   │
        └────────┬─────────┘
                 │
    ┌────────────┴────────────┐
    │ OPTION A: Seller        │ OPTION B: Auto-refund
    │ dispatches within 7 days│ (no action after 7 days)
    │                         │
    ▼                         ▼
SELLER_DISPATCHED       CANCELLED + REFUNDED
(Inspection: 48h)       (Funds back to buyer)
    │
    ├─ Buyer verifies  OR  Auto-verify after 48h
    │
    ▼
BUYER_VERIFIED
    │
    ├─ Buyer releases payout
    │
    ▼
PAYOUT_RELEASED
    │
    ├─ Funds transfer to seller
    ├─ Platform fee deducted
    └─ Settlement completes
```

---

## Key Differences: Paystack vs. Escrow

| Aspect | Paystack (Gateway) | Our System (Escrow) |
|--------|-------|---------|
| Payment capture | Immediate | Immediate |
| Settlement | Paystack handles | We control timing |
| Refund capability | Limited | Full control |
| Fund release | Automatic | Conditional (buyer confirms) |
| Dispute handling | Gateway's rules | Our business logic |

---

## API Endpoints

### For Buyers
- `POST /api/v1/transactions/:id/verify-delivery` — Confirm product received
- `POST /api/v1/transactions/:id/release-payout` — Release funds to seller
- `POST /api/v1/transactions/:id/dispute` — Open dispute

### For Sellers
- `POST /api/v1/transactions/:id/dispatch` — Mark order as shipped

### For Admin/System
- **Cron jobs** (automatic)
  - Inspection deadline: every hour
  - Auto-refund: daily at 2 AM UTC

---

## Configuration

```typescript
// .env
PAYSTACK_SECRET_KEY=sk_test_...
```

Constants in `refunds.service.ts`:
```typescript
const ESCROW_HOLD_DAYS = 7;        // Days before auto-refund
```

Constants in `transactions.service.ts`:
```typescript
const INSPECTION_HOURS = 48;       // Hours before auto-verify
```

---

## Testing Option B Flow

### Step 1: Create & Pay
```bash
curl -X POST http://localhost:4000/api/v1/transactions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "listingId": "listing-123",
    "gateway": "paystack"
  }'
# Returns authorizationUrl
```

### Step 2: Simulate Paystack Webhook
```bash
curl -X POST http://localhost:4000/api/v1/payments/webhook/paystack \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: <signature>" \
  -d '{
    "event": "charge.success",
    "data": {
      "reference": "ref-123",
      "amount": 5000000,
      "currency": "NGN"
    }
  }'
# Transaction moves to ESCROW_HELD
```

### Step 3: Seller Dispatches
```bash
curl -X POST http://localhost:4000/api/v1/transactions/:id/dispatch \
  -H "Authorization: Bearer <seller-token>" \
  -H "Content-Type: application/json" \
  -d '{"dispatchReference": "TRACK-12345"}'
# Transaction moves to SELLER_DISPATCHED
```

### Step 4: Buyer Verifies
```bash
curl -X POST http://localhost:4000/api/v1/transactions/:id/verify-delivery \
  -H "Authorization: Bearer <buyer-token>" \
  -H "Content-Type: application/json" \
  -d '{"note": "Product received in good condition"}'
# Transaction moves to BUYER_VERIFIED
```

### Step 5: Buyer Releases Payout
```bash
curl -X POST http://localhost:4000/api/v1/transactions/:id/release-payout \
  -H "Authorization: Bearer <buyer-token>"
# Transaction moves to PAYOUT_RELEASED
# executeSellerPayout() is triggered asynchronously
```

---

## Error Handling

- **Signature mismatch**: Webhook rejected, transaction stays PENDING
- **Amount mismatch**: Webhook ignored, transaction stays PENDING
- **Seller has no bank account**: Payout deferred, logged for manual follow-up
- **Paystack refund fails**: Exception logged, transaction remains ESCROW_HELD (retry on next cron)

---

## Future Enhancements

1. **Partial refunds** — if buyer disputes amount
2. **Escrow dispute arbitration** — support team review flow
3. **Split payments** — platform fee held separately
4. **Webhook resend** — if Paystack resends, idempotent check
5. **Payout scheduling** — hold funds until settlement window closes
