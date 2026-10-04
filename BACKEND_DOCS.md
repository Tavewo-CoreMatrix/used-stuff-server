# Used-Stuff Backend — Developer Documentation

> Last updated: 2026-07-27

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Getting Started](#3-getting-started)
4. [Environment Variables](#4-environment-variables)
5. [Database & Schema](#5-database--schema)
6. [API Reference](#6-api-reference)
7. [Services](#7-services)
8. [Escrow State Machine](#8-escrow-state-machine)
9. [Queue System (BullMQ)](#9-queue-system-bullmq)
10. [Middleware](#10-middleware)
11. [External Integrations](#11-external-integrations)
12. [Scripts & Admin Tools](#12-scripts--admin-tools)
13. [Testing](#13-testing)

---

## 1. Overview

Used-Stuff is a peer-to-peer second-hand goods marketplace. The backend is an Express 5 + TypeScript API backed by a PostgreSQL database (Supabase), a Redis-powered job queue (BullMQ), Paystack for payment processing and bank transfers, and Cloudinary for image hosting.

**Core flows:**
- Sellers list items → Buyers purchase via Paystack → Funds are held in escrow → Seller dispatches → Buyer confirms receipt → Funds are released to seller's bank account minus a 5% platform fee.
- An admin can intervene at any point via the dispute system.
- All timed automations (payment expiry, inspection deadlines, escrow timeouts) run as background BullMQ jobs.

---

## 2. Architecture

```
src/
├── app.ts                  # Express app factory — mounts middleware, routes, BullBoard
├── server.ts               # Entry point — boots app + starts BullMQ workers
├── config/env.ts           # Env var validation (throws on startup if required vars missing)
│
├── routes/                 # Express routers — thin, delegates to controllers
├── controllers/            # Request handlers — parse req, call service, send response
├── services/               # Business logic — all DB writes, external API calls
│
├── queues/index.ts         # Queue definitions, job type interfaces, scheduling helpers
├── workers/                # BullMQ worker processes (transaction, payout, refund)
│
├── middleware/             # Auth, error, rate-limit, upload, not-found
├── db/                     # Prisma client singleton
├── lib/paystack.ts         # Paystack SDK singleton
└── utils/                  # token, password, email, HttpError, asyncHandler
```

All routes are mounted under `/api/v1`.

---

## 3. Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL (Supabase)
- Redis (local or upstash)

### Install & run

```bash
bun install
cp .env.example .env
# Fill in .env values

bun run prisma:migrate      # Run DB migrations
bun run dev                 # Start dev server with hot reload (tsx watch)
```

### Build for production

```bash
bun run build               # tsc → dist/
bun run start               # node dist/server.js
```

---

## 4. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Controls error detail in responses |
| `PORT` | No | `4000` | HTTP listen port |
| `HOST` | No | `0.0.0.0` | HTTP listen host |
| `DATABASE_URL` | Yes | — | Supabase PostgreSQL connection string; use the `postgres` database role for the Prisma backend |
| `AUTH_TOKEN_SECRET` | Yes | — | JWT signing secret |
| `AUTH_TOKEN_EXPIRES_IN_SECONDS` | No | `604800` | JWT TTL (7 days) |
| `CORS_ORIGIN` | Yes (prod) | — | Comma-separated allowed origins |
| `RATE_LIMIT_WINDOW_MS` | No | — | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | No | `120` | Max requests per window per IP |
| `PAYSTACK_SECRET_KEY` | Yes | — | Paystack secret key (`sk_live_…`) |
| `PAYSTACK_PUBLIC_KEY` | Yes | — | Paystack public key (`pk_live_…`) |
| `FLUTTERWAVE_SECRET_HASH` | No | — | Flutterwave webhook verification hash |
| `RESEND_API_KEY` | Yes | — | Transactional email via Resend |
| `EMAIL_FROM` | Yes | — | Sender address for auth emails |
| `OTP_EXPIRES_IN_MINUTES` | No | `15` | OTP validity window |
| `RESET_TOKEN_EXPIRES_IN_MINUTES` | No | `15` | Password reset token validity |
| `CLOUDINARY_CLOUD_NAME` | Yes | — | Cloudinary project name |
| `CLOUDINARY_API_KEY` | Yes | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | — | Cloudinary API secret |
| `REDIS_URL` | No | `redis://localhost:6379` | BullMQ / ioredis connection. Use `rediss://` for TLS |
| `BULL_BOARD_USERNAME` | Yes (prod) | — | BullBoard dashboard Basic Auth username |
| `BULL_BOARD_PASSWORD` | Yes (prod) | — | BullBoard dashboard Basic Auth password |

---

## 5. Database & Schema

ORM: **Prisma 7** with the `@prisma/adapter-pg` adapter against PostgreSQL.

### Enums

| Enum | Values |
|------|--------|
| `AccountRole` | `BUYER`, `SELLER`, `ADMIN` |
| `AccountStatus` | `ACTIVE`, `SUSPENDED`, `DELETED` |
| `ItemCondition` | `NEW`, `LIKE_NEW`, `GOOD`, `FAIR`, `POOR` |
| `ListingStatus` | `DRAFT`, `ACTIVE`, `RESERVED`, `SOLD`, `ARCHIVED` |
| `TransactionStatus` | `PENDING`, `ESCROW_HELD`, `SELLER_DISPATCHED`, `BUYER_VERIFIED`, `PAYOUT_RELEASED`, `DISPUTED`, `CANCELLED` |

### Models

#### `Account`
Core user record. Each account has exactly one role. OTP and reset tokens are stored as **bcrypt hashes**, never plaintext.

| Field | Type | Notes |
|---|---|---|
| `id` | String (cuid) | PK |
| `email` | String | Unique |
| `phone` | String? | |
| `passwordHash` | String | bcrypt |
| `role` | AccountRole | Default `BUYER` |
| `status` | AccountStatus | Default `ACTIVE` |
| `emailVerified` | Boolean | Set true on OTP verification |
| `otpCode` | String? | Bcrypt-hashed 4-digit OTP |
| `otpExpiresAt` | DateTime? | |
| `resetToken` | String? | Bcrypt-hashed reset token |
| `resetTokenExpiresAt` | DateTime? | |
| `pushToken` | String? | Expo push token |

Relations: `profile` (1:1), `bankAccount` (1:1), `items[]`, `listings[]`, `purchases[]`, `sales[]`

#### `Profile`
Display information. Created/updated via `PUT /accounts/:id/profile`.

| Field | Type |
|---|---|
| `accountId` | FK → Account (unique) |
| `displayName` | String |
| `avatarUrl` | String? |
| `city` | String? |
| `state` | String? |
| `country` | String (default `"Nigeria"`) |

#### `BankAccount`
Seller's payout destination. Verified via Paystack before saving.

| Field | Type |
|---|---|
| `accountId` | FK → Account (unique) |
| `bankCode` | String (e.g. `"058"` for GTBank) |
| `accountNumber` | String (10 digits) |
| `accountName` | String (from Paystack resolve) |

#### `Item`
A physical product owned by a seller.

| Field | Type |
|---|---|
| `ownerId` | FK → Account |
| `title` | String |
| `description` | String? |
| `category` | String |
| `brand` | String? |
| `condition` | ItemCondition |
| `imageUrls` | String[] |

#### `Listing`
A priced offer to sell an Item.

| Field | Type |
|---|---|
| `sellerId` | FK → Account |
| `itemId` | FK → Item |
| `price` | Decimal (12, 2) |
| `currency` | String (default `"NGN"`) |
| `status` | ListingStatus |
| `locationCity` | String? |

#### `Transaction`
Central escrow record. Created when a buyer initiates a purchase.

| Field | Type | Notes |
|---|---|---|
| `orderNumber` | String | Unique. Format: `US-YYYYMMDD-XXXXXXXX` |
| `listingId` | FK → Listing | |
| `buyerId` | FK → Account | |
| `sellerId` | FK → Account | |
| `amount` | Decimal (12, 2) | Locked at purchase time |
| `currency` | String | |
| `status` | TransactionStatus | |
| `paymentReference` | String | Unique. Paystack reference |
| `paymentTransactionHash` | String? | Unique. Paystack hash from webhook |
| `escrowHeldAt` | DateTime? | |
| `sellerDispatchedAt` | DateTime? | |
| `sellerDispatchReference` | String? | Tracking number / waybill |
| `buyerVerifiedAt` | DateTime? | |
| `buyerVerificationNote` | String? | |
| `inspectionDeadlineAt` | DateTime? | 48h after dispatch — auto-verifies if buyer silent |
| `deliveryAddress` | Json | Snapshot of buyer's address at purchase |
| `disputeReason` | String? | |
| `disputeOpenedAt` | DateTime? | |
| `cancelledAt` | DateTime? | |
| `payoutReleasedAt` | DateTime? | |
| `payoutTransferCode` | String? | Paystack transfer code |
| `payoutSettledAt` | DateTime? | |
| `payoutFailedAt` | DateTime? | |
| `payoutFailureReason` | String? | |

#### `StateHistory`
Immutable audit trail. A row is appended on every transaction status change.

| Field | Type |
|---|---|
| `transactionId` | FK → Transaction |
| `fromStatus` | TransactionStatus? |
| `toStatus` | TransactionStatus |
| `reason` | String? |
| `metadata` | Json |

---

## 6. API Reference

### Authentication

All protected endpoints require a Bearer JWT in the `Authorization` header:
```
Authorization: Bearer <token>
```

Tokens are issued at login and OTP-verify. They expire after `AUTH_TOKEN_EXPIRES_IN_SECONDS` (default 7 days).

---

### `GET /api/v1/health`
Public. Returns DB connectivity status and service uptime.

---

### Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | Public | Create account + send OTP email |
| POST | `/verify-otp` | Public | Verify 4-digit OTP; returns JWT + user |
| POST | `/login` | Public | Email + password; returns JWT + user |
| POST | `/forgot-password` | Public | Send reset token email |
| POST | `/reset-password` | Public | Consume token, set new password |
| GET | `/me` | Bearer | Return own account object |
| DELETE | `/delete` | Bearer | Soft-delete own account |

**Register body:**
```json
{ "email": "user@example.com", "password": "secret", "role": "BUYER" }
```

**Login response:**
```json
{ "data": { "token": "eyJ...", "user": { "id": "...", "email": "...", "role": "BUYER", ... } } }
```

---

### Accounts — `/api/v1/accounts`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Admin | List all accounts |
| POST | `/` | Admin | Create account directly |
| GET | `/banks` | Bearer | List Nigerian banks from Paystack (24h server cache) |
| GET | `/:accountId` | Bearer | Get account (own, or any if admin) |
| PUT | `/:accountId/profile` | Bearer | Create or update profile |
| GET | `/:accountId/bank-account/verify` | Bearer | Verify bank account number via Paystack |
| PUT | `/:accountId/bank-account` | Bearer | Save verified bank account |
| PUT | `/:accountId/push-token` | Bearer | Register Expo push notification token |
| PATCH | `/:accountId/status` | Admin | Suspend or reactivate account |

**List banks** — `GET /accounts/banks`
Returns: `{ data: [{ name: "Access Bank", code: "044" }, ...] }`
Registered before `/:accountId` in the router so `"banks"` isn't swallowed as a route param.

**Verify bank account** — `GET /accounts/:id/bank-account/verify`
Query params: `account_number` (10 digits), `bank_code` (Paystack bank code)
Returns: `{ data: { accountName: "JOHN DOE" } }`

**Upsert bank account** — `PUT /accounts/:id/bank-account`
```json
{ "bankCode": "058", "accountNumber": "0123456789", "accountName": "JOHN DOE" }
```

---

### Items — `/api/v1/items`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Public | List all items |
| GET | `/mine` | Bearer | List own items |
| POST | `/upload-image` | Bearer | Upload image to Cloudinary (multipart) |
| POST | `/` | Bearer | Create item |
| GET | `/:itemId` | Public | Get item by ID |
| PATCH | `/:itemId` | Bearer | Update item (owner only) |
| DELETE | `/:itemId` | Bearer | Delete item (owner only) |

---

### Listings — `/api/v1/listings`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Public | List active listings |
| GET | `/mine` | Bearer | List own listings |
| POST | `/` | Bearer | Create listing |
| GET | `/:listingId` | Public | Get listing by ID |
| PATCH | `/:listingId` | Bearer | Update listing (seller only) |
| DELETE | `/:listingId` | Bearer | Delete listing (blocked if has orders) |

---

### Transactions — `/api/v1/transactions`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Admin | List all transactions |
| GET | `/mine` | Bearer | List own (as buyer or seller) |
| POST | `/` | Bearer | Initiate purchase — creates transaction + Paystack payment link |
| GET | `/:transactionId` | Bearer | Get transaction detail |
| PATCH | `/:transactionId/status` | Bearer | Generic status update |
| POST | `/:transactionId/confirm-payment` | Bearer (buyer) | Sync payment confirmation with Paystack |
| POST | `/:transactionId/dispatch` | Bearer (seller) | Mark item dispatched |
| POST | `/:transactionId/verify-delivery` | Bearer (buyer) | Confirm delivery, optionally release immediately |
| POST | `/:transactionId/dispute` | Bearer | Open a dispute |
| POST | `/:transactionId/cancel` | Bearer | Cancel (only from PENDING) |
| POST | `/:transactionId/release-payout` | Bearer (buyer) | Manually release funds to seller |
| POST | `/:transactionId/resolve-dispute` | Admin | Resolve dispute with release or refund |

**Create transaction body:**
```json
{
  "listingId": "...",
  "deliveryAddress": { "street": "...", "city": "...", "state": "..." }
}
```
Response includes a Paystack `authorizationUrl` for the mobile checkout WebView.

**Confirm payment** — `POST /transactions/:id/confirm-payment`
Called immediately after Paystack checkout succeeds on mobile. Verifies the charge directly with Paystack and transitions to `ESCROW_HELD` synchronously (no webhook lag). The webhook remains a safety net fallback.

**Dispatch body:**
```json
{ "dispatchReference": "WAYBILL-123" }
```

**Resolve dispute** (admin only):
```json
{ "resolution": "release", "reason": "Buyer confirmed receipt via chat" }
// or
{ "resolution": "refund", "reason": "Seller failed to dispatch" }
```

---

### Payments — `/api/v1/payments`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhook/paystack` | Public (sig) | Paystack event webhook handler |
| POST | `/webhook/flutterwave` | Public (hash) | Flutterwave event webhook handler |

Webhook endpoints verify signatures/hashes before processing. Paystack uses HMAC-SHA512 against the raw request body.

---

### Verification — `/api/v1/verification`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/verify-tag` | Bearer | Upload solar equipment label image for AI OCR |

Sends the image to GPT-4o-mini via OpenAI Vision. Returns extracted fields: `brand`, `model`, `wattage`, `voltage`, `capacity`, `technology`.

---

### Admin Dashboard

`GET /admin/queues` — BullBoard UI (HTTP Basic Auth). Shows all queues, active/waiting/failed/completed jobs, job details.

---

## 7. Services

### `auth.service.ts`
Handles the full authentication lifecycle.
- `register`: hashes password, generates 4-digit OTP, sends email via Resend.
- `verifyOtp`: compares bcrypt-hashed OTP, marks `emailVerified = true`, returns JWT.
- `login`: verifies password, checks account is `ACTIVE` and `emailVerified`.
- `forgotPassword`: generates a secure random token, bcrypt-hashes and stores it, emails a reset link.
- `resetPassword`: verifies token (timing-safe bcrypt compare), checks expiry, updates password, clears token.

### `transactions.service.ts`
The most complex service. Owns the escrow state machine.
- `createTransaction`: validates listing is ACTIVE, locks amount and delivery address, generates a unique `orderNumber`, initialises a Paystack payment, schedules `expire-pending` job (24h).
- `getTransactionById`: ownership check — buyer or seller only, unless `isAdmin = true`.
- `systemUpdateTransactionStatus`: used by workers and webhook handlers for trusted internal transitions (bypasses actor checks).
- All actor-facing transitions (`markSellerDispatched`, `markBuyerVerified`, `openDispute`, `releasePayout`, `resolveDispute`) validate the current status against an allowed-transitions table before writing.

### `payments.service.ts`
- `initializePayment`: creates a Paystack transaction and returns the `authorization_url`.
- `verifyPaystackSignature`: HMAC-SHA512 of raw body against `PAYSTACK_SECRET_KEY`.
- `processWebhookPayment`: idempotent — no-ops if transaction is already past PENDING. Transitions to `ESCROW_HELD`, schedules `expire-escrow` (7d).
- `confirmPaymentSync`: buyer-triggered, verifies charge directly with Paystack SDK, calls `processWebhookPayment`.

### `payouts.service.ts`
- `executeSellerPayout`: calculates 95% of transaction amount (5% fee), calls Paystack Transfers API using the seller's `BankAccount`, stores `payoutTransferCode`.
- `handleTransferWebhook`: processes `transfer.success`, `transfer.failed`, `transfer.reversed` events from Paystack, updates transaction fields accordingly.

### `refunds.service.ts`
- `executeRefund`: calls Paystack refund API against the `paymentTransactionHash`.
- `autoRefundStaleEscrow`: scans for ESCROW_HELD transactions older than 7 days and queues refunds.
- `cleanupStalePending`: cancels PENDING transactions older than 24h (safety net alongside the BullMQ job).

### `bank-accounts.service.ts`
- `verifyBankAccount`: calls Paystack `GET /bank/resolve` with `account_number` and `bank_code`. Returns the resolved account name.
- `upsertBankAccount`: creates or updates the `BankAccount` record for an account.

### `notifications.service.ts`
Sends Expo push notifications to both parties on every significant transaction state change. Uses `fetch` directly to the Expo Push API. Silently logs failures — a failed notification should never block a transaction transition.

### `ai-verification.service.ts`
Accepts a solar equipment image (URL or base64), sends it through an AI vision pipeline with a structured extraction prompt, and returns parsed fields: `brand`, `model`, `wattage`, `voltage`, `capacity`, `technology`.

---

## 8. Escrow State Machine

```
PENDING
  │
  ├─ (payment confirmed) ──────────→ ESCROW_HELD
  │                                      │
  ├─ (24h timeout / cancel) ──→ CANCELLED │
                                           ├─ (seller dispatches) ──→ SELLER_DISPATCHED
                                           │                               │
                                           ├─ (7d timeout) ──→ CANCELLED  ├─ (buyer confirms) ──→ BUYER_VERIFIED
                                           │                               │                           │
                                           └─ (dispute opened) ──→ DISPUTED ◄── (dispute opened)       └─ (payout released) ──→ PAYOUT_RELEASED
                                                                     │         (48h timeout →
                                                                     │          auto BUYER_VERIFIED)
                                                                     │
                                                             (admin resolves)
                                                             ├─ release ──→ PAYOUT_RELEASED
                                                             └─ refund  ──→ CANCELLED
```

**Allowed transitions table (enforced in `transactions.service.ts`):**

| From | To | Actor |
|---|---|---|
| `PENDING` | `ESCROW_HELD` | System (webhook / confirm-payment) |
| `PENDING` | `CANCELLED` | Buyer or System (expire job) |
| `ESCROW_HELD` | `SELLER_DISPATCHED` | Seller |
| `ESCROW_HELD` | `DISPUTED` | Buyer or Seller |
| `ESCROW_HELD` | `CANCELLED` | System (escrow timeout job) |
| `SELLER_DISPATCHED` | `BUYER_VERIFIED` | Buyer or System (inspection deadline job) |
| `SELLER_DISPATCHED` | `DISPUTED` | Buyer or Seller |
| `BUYER_VERIFIED` | `PAYOUT_RELEASED` | Buyer |
| `DISPUTED` | `PAYOUT_RELEASED` | Admin (resolution: release) |
| `DISPUTED` | `CANCELLED` | Admin (resolution: refund) |

Any transition not in this table throws `HttpError(400, "Invalid status transition")`.

---

## 9. Queue System (BullMQ)

Three queues backed by Redis:

### `transactions` queue

| Job | Delay | Action |
|---|---|---|
| `expire-pending` | 24 hours | If still `PENDING`, cancel the transaction |
| `confirm-payment` | Immediate | Process a Paystack webhook payment event |
| `expire-inspection` | 48 hours after dispatch | If still `SELLER_DISPATCHED`, auto-transition to `BUYER_VERIFIED` |
| `expire-escrow` | 7 days | If still `ESCROW_HELD`, queue a refund and cancel |

### `payouts` queue

| Job | Delay | Action |
|---|---|---|
| `release-payout` | Immediate | Call `executeSellerPayout` (Paystack transfer) |

Retry: 10 attempts, exponential backoff starting at 30s.

### `refunds` queue

| Job | Delay | Action |
|---|---|---|
| `process-refund` | Immediate | Call `executeRefund` (Paystack refund) |

Retry: 10 attempts, exponential backoff starting at 30s.

### Idempotency

Jobs use prefixed `jobId` (e.g. `expire-pending:${transactionId}`) so scheduling the same job twice is a no-op. All worker handlers guard against acting on a transaction that has already moved past the expected state — they check the current status before writing.

---

## 10. Middleware

### `auth.middleware.ts` — `requireAuth`
Extracts the `Authorization: Bearer <token>` header, verifies the JWT, then makes a live DB call to confirm the account is still `ACTIVE` (catches suspended accounts even on unexpired tokens). Attaches `req.auth = { accountId, role }` for downstream use.

### `error.middleware.ts`
Global error handler. Maps `HttpError` instances to their correct HTTP status codes. In production (`NODE_ENV === 'production'`), 500-level errors return a generic message to avoid leaking internals.

### `rate-limit.middleware.ts`
In-process sliding window rate limiter keyed by IP address. Default: 120 requests per minute. Implemented as an in-memory Map — **not Redis-backed**, so it resets on server restart and does not work across multiple instances. Suitable for single-server deployments.

### `upload.middleware.ts`
Multer with memory storage. Accepts image MIME types only (`image/*`). 10MB file size limit.

---

## 11. External Integrations

### Paystack
- **SDK:** `@paystack/paystack-sdk`
- **Payment init:** `paystack.transaction.initialize()` — returns `authorization_url` for the mobile WebView checkout.
- **Charge verify:** `paystack.transaction.verify({ reference })` — used by sync confirmation endpoint.
- **Bank resolve:** `paystack.verification.resolveAccountNumber()` — verifies seller bank accounts.
- **Transfers:** `paystack.transfer.initiate()` — releases seller payouts (95% after 5% fee).
- **Refunds:** `paystack.refund.create()` — returns funds to buyer.
- **Webhooks:** `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed` events handled at `/api/v1/payments/webhook/paystack`.

### Resend
Transactional email for OTP codes and password reset links. Configured via `RESEND_API_KEY` and `EMAIL_FROM`.

### Cloudinary
Image uploads flow through `sharp` (resize / convert to WebP) then upload to Cloudinary. Images are served directly from Cloudinary CDN — the backend stores only the returned URL string.

### Expo Push Notifications
Push tokens are stored on the `Account` model (`pushToken`). Notifications are sent via `fetch` to `https://exp.host/--/api/v2/push/send`. No FCM/APNs setup required.

### OpenAI (optional)
GPT-4o-mini Vision is used for the solar equipment label verification feature. Only required if using `POST /api/v1/verification/verify-tag`.

---

## 12. Scripts & Admin Tools

### Create admin account
```bash
bun run create-admin
```
Runs `scripts/create-admin.ts` — creates an account with `role: ADMIN`. Edit the script to set the email and password before running.

### Prisma Studio
```bash
bun run prisma:studio
```
Opens a local GUI to browse and edit the database directly.

### BullBoard UI
`http://localhost:4000/admin/queues` — protected by HTTP Basic Auth (`BULL_BOARD_USERNAME` / `BULL_BOARD_PASSWORD`). Inspect queue depth, view failed jobs, retry individual jobs.

---

## 13. Testing

**Framework:** Vitest + vitest-mock-extended (typed Prisma mocks)

```bash
bun run test          # Run all tests once
bun run test --watch  # Watch mode
```

Tests live in `tests/` mirroring the `src/` structure:
- `tests/services/` — unit tests for service functions (Prisma client mocked)
- `tests/controllers/` — controller-level tests
- `tests/workers/` — worker handler tests (verify idempotency guards)

`tests/setup.ts` provides the shared Prisma mock setup used across all service tests.

**Coverage focus:**
- Escrow state transitions (allowed + rejected)
- Dispute open / resolve (release and refund paths)
- Worker idempotency (job acts on stale state → no-op)
- Payout and refund execution
