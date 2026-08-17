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

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/accounts`
- `POST /api/v1/accounts`
- `GET /api/v1/accounts/:accountId`
- `PUT /api/v1/accounts/:accountId/profile`
- `GET /api/v1/items`
- `GET /api/v1/items/mine`
- `POST /api/v1/items`
- `GET /api/v1/items/:itemId`
- `PATCH /api/v1/items/:itemId`
- `DELETE /api/v1/items/:itemId`
- `GET /api/v1/listings`
- `GET /api/v1/listings/mine`
- `POST /api/v1/listings`
- `GET /api/v1/listings/:listingId`
- `PATCH /api/v1/listings/:listingId`
- `DELETE /api/v1/listings/:listingId`
- `GET /api/v1/transactions/mine`
- `POST /api/v1/transactions`
- `GET /api/v1/transactions/:transactionId`
- `PATCH /api/v1/transactions/:transactionId/status`
- `POST /api/v1/transactions/:transactionId/dispatch`
- `POST /api/v1/transactions/:transactionId/verify-delivery`
- `POST /api/v1/transactions/:transactionId/dispute`
- `POST /api/v1/transactions/:transactionId/cancel`
- `POST /api/v1/transactions/:transactionId/release-payout`

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

Sprint 10 order actions:

- Seller dispatches: `POST /api/v1/transactions/:transactionId/dispatch`
- Buyer verifies delivery: `POST /api/v1/transactions/:transactionId/verify-delivery`
- Buyer or seller opens dispute: `POST /api/v1/transactions/:transactionId/dispute`
- Buyer or seller cancels while allowed: `POST /api/v1/transactions/:transactionId/cancel`
- Buyer releases payout after verification: `POST /api/v1/transactions/:transactionId/release-payout`
