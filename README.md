# used-stuff Backend

Express + Prisma backend for the used-stuff marketplace.

## First Run

1. Copy `.env.example` to `.env`.
2. Add your Neon `DATABASE_URL` to `.env`.
3. Run `npm install` if dependencies are not fully installed.
4. Run `npm run prisma:generate`.
5. Run `npm run prisma:migrate -- --name init`.
6. Run `npm run dev`.

The health check is available at `GET /api/v1/health`.

## Development Server

Run:

```powershell
npm run dev
```

The dev script uses `tsx watch`, so the backend automatically restarts when files change.

By default, the API binds to `0.0.0.0:4000`, which makes it reachable from mobile simulators and devices on your network.

## Mobile API Base URLs

- Local browser: `http://localhost:4000/api/v1`
- Android emulator: `http://10.0.2.2:4000/api/v1`
- iOS simulator: `http://localhost:4000/api/v1`
- Physical phone: `http://YOUR_COMPUTER_LAN_IP:4000/api/v1`

## Current Endpoints

_Last reconciled against `src/routes/` on 4 October 2026 — this list previously lagged the actual implementation by several sprints (missing admin, verification, wanted-requests, bank-accounts, push-tokens, payments webhooks, dispute-evidence, and upload, plus several auth and transaction routes). Regenerate this section from the router files rather than hand-editing it when routes change._

**Health**
- `GET /api/v1/health`

**Auth** (`/api/v1/auth`)
- `POST /auth/register`
- `POST /auth/verify-otp`
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `GET /auth/me` _(auth required)_
- `POST /auth/verify-password` _(auth required)_
- `POST /auth/security-question` _(auth required)_
- `DELETE /auth/security-question` _(auth required)_
- `POST /auth/verify-security-answer` _(auth required)_
- `DELETE /auth/delete` _(auth required)_

**Admin** (`/api/v1/admin` — all routes require an `ADMIN` account)
- `GET /admin/stats`
- `GET /admin/audit-log`
- `GET /admin/attention`
- `POST /admin/orders/:transactionId/resolve`
- `GET /admin/listings`
- `POST /admin/listings/:listingId/remove`
- `POST /admin/listings/:listingId/restore`

**Accounts** (`/api/v1/accounts` — all routes require authentication)
- `GET /accounts` _(admin)_
- `POST /accounts` _(admin)_
- `GET /accounts/banks`
- `GET /accounts/:accountId`
- `PUT /accounts/:accountId/profile`
- `GET /accounts/:accountId/bank-account/verify`
- `PUT /accounts/:accountId/bank-account`
- `PUT /accounts/:accountId/push-token`
- `PATCH /accounts/:accountId/status` _(admin)_

**Items** (`/api/v1/items`)
- `GET /items`
- `GET /items/mine` _(auth required)_
- `POST /items/upload-image` _(auth required)_
- `POST /items` _(auth required)_
- `GET /items/:itemId`
- `PATCH /items/:itemId` _(auth required)_
- `DELETE /items/:itemId` _(auth required)_

**Listings** (`/api/v1/listings`)
- `GET /listings`
- `GET /listings/mine` _(auth required)_
- `POST /listings` _(auth required)_
- `GET /listings/:listingId`
- `PATCH /listings/:listingId` _(auth required)_
- `DELETE /listings/:listingId` _(auth required)_

**Transactions** (`/api/v1/transactions` — all routes require authentication)
- `GET /transactions`
- `GET /transactions/mine`
- `POST /transactions`
- `GET /transactions/:transactionId`
- `PATCH /transactions/:transactionId/status`
- `POST /transactions/:transactionId/dispatch`
- `POST /transactions/:transactionId/verify-delivery`
- `POST /transactions/:transactionId/dispute`
- `GET /transactions/:transactionId/evidence`
- `POST /transactions/:transactionId/evidence`
- `POST /transactions/:transactionId/cancel`
- `POST /transactions/:transactionId/release-payout`
- `POST /transactions/:transactionId/resolve-dispute`
- `POST /transactions/:transactionId/confirm-payment`

**Payments** (`/api/v1/payments` — public webhook endpoints, secured via gateway signature verification inside the controller, not auth middleware)
- `POST /payments/webhook/paystack`
- `POST /payments/webhook/flutterwave`

**Verification** (`/api/v1/verification`)
- `POST /verification/verify-tag` _(auth required)_ — AI verification of equipment tags.

**Wanted Requests** (`/api/v1/wanted-requests` — all routes require authentication)
- `POST /wanted-requests`
- `GET /wanted-requests/mine`
- `DELETE /wanted-requests/:id`

## Authentication Flow

The mobile app should register or log in, store the returned bearer token securely, then send it in the `Authorization` header.

Example register payload:

```json
{
  "email": "seller@example.com",
  "phone": "+2348000000000",
  "password": "password123",
  "role": "SELLER",
  "profile": {
    "displayName": "Demo Seller",
    "city": "Lagos",
    "state": "Lagos"
  }
}
```

Example login payload:

```json
{
  "email": "seller@example.com",
  "password": "password123"
}
```

Example authenticated request:

```http
GET /api/v1/auth/me
Authorization: Bearer YOUR_TOKEN_HERE
```

## Seller Marketplace Flow

1. Register or log in as a `SELLER`.
2. Create an item using `POST /api/v1/items`.
3. Publish that item using `POST /api/v1/listings`.
4. Buyers can browse `GET /api/v1/listings?status=ACTIVE`.

Example item payload:

```json
{
  "title": "Used iPhone 13",
  "description": "Clean phone with original charger.",
  "category": "Phones",
  "brand": "Apple",
  "condition": "GOOD"
}
```

Example listing payload:

```json
{
  "itemId": "ITEM_ID_FROM_CREATE_ITEM",
  "price": 450000,
  "currency": "NGN",
  "locationCity": "Lagos",
  "status": "ACTIVE"
}
```

## Buyer Transaction Flow

1. Register or log in as a `BUYER`.
2. Browse active listings with `GET /api/v1/listings?status=ACTIVE`.
3. Start a purchase with `POST /api/v1/transactions`.
4. The listing becomes `RESERVED`, and the transaction starts at `PENDING`.
5. Move through escrow states as payment, dispatch, verification, and payout happen.

Example transaction payload:

```json
{
  "listingId": "ACTIVE_LISTING_ID",
  "deliveryAddress": {
    "fullName": "Ada Buyer",
    "phone": "+2348000000000",
    "street": "12 Example Street",
    "city": "Lagos",
    "state": "Lagos"
  }
}
```

Example status update payload:

```json
{
  "status": "ESCROW_HELD",
  "reason": "Payment confirmed by gateway",
  "metadata": {
    "gateway": "paystack",
    "reference": "demo-reference"
  }
}
```

Allowed escrow transitions:

- `PENDING → ESCROW_HELD`
- `PENDING → CANCELLED`
- `ESCROW_HELD → SELLER_DISPATCHED`
- `ESCROW_HELD → DISPUTED`
- `ESCROW_HELD → CANCELLED`
- `SELLER_DISPATCHED → BUYER_VERIFIED`
- `SELLER_DISPATCHED → DISPUTED`
- `BUYER_VERIFIED → PAYOUT_RELEASED`
- `BUYER_VERIFIED → DISPUTED`

Order actions:

- Seller dispatches: `POST /api/v1/transactions/:transactionId/dispatch`
- Buyer verifies delivery: `POST /api/v1/transactions/:transactionId/verify-delivery`
- Buyer or seller opens dispute: `POST /api/v1/transactions/:transactionId/dispute`
- Buyer or seller adds dispute evidence: `POST /api/v1/transactions/:transactionId/evidence`
- Buyer or seller cancels while allowed: `POST /api/v1/transactions/:transactionId/cancel`
- Buyer releases payout after verification: `POST /api/v1/transactions/:transactionId/release-payout`
- Admin resolves an open dispute: `POST /api/v1/transactions/:transactionId/resolve-dispute`
- Payment confirmation sync, best-effort alongside the webhook: `POST /api/v1/transactions/:transactionId/confirm-payment`
