# Deploying storage payments with PayOS

## Render environment

Configure these values on the Backend service. Never commit the real merchant
credentials to Git.

| Key | Production value |
|---|---|
| `PAYMENT_PROVIDER` | `PAYOS` |
| `PAYOS_CLIENT_ID` | PayOS production channel secret |
| `PAYOS_API_KEY` | PayOS production channel secret |
| `PAYOS_CHECKSUM_KEY` | PayOS production channel secret |
| `PUBLIC_API_URL` | `https://backendd-vn1j.onrender.com` |
| `FRONTEND_URL` | Current stable Vercel production URL |
| `MOBILE_APP_SCHEME` | `aistudyhub` |
| `STORAGE_ORDER_TTL_MINUTES` | `15` |
| `STORAGE_QUOTA_ENFORCED` | `true` |

Use Render Dashboard secrets for the three `PAYOS_*` values. Saving them must
restart/redeploy the service so the process reads the new environment.

## PayOS webhook

Register this URL on the production PayOS payment channel:

```text
https://backendd-vn1j.onrender.com/api/storage/payments/payos/webhook
```

PayOS sends `POST` JSON payloads. The Backend verifies the checksum signature,
matches the numeric `orderCode`, validates the exact VND amount, and performs an
atomic `PENDING -> COMPLETED` transition before activating the storage package.
Duplicate notifications are safe and never apply quota twice.

The browser return and cancel endpoints are generated per payment link:

```text
https://backendd-vn1j.onrender.com/api/storage/payments/payos/return
https://backendd-vn1j.onrender.com/api/storage/payments/payos/cancel
```

Those routes only return the user to Web or the saved Mobile deep link. The
webhook and authenticated transaction polling remain authoritative.

## Local real-payment testing

Create a separate PayOS development channel with different credentials. Expose
the local Backend through an HTTPS tunnel and set:

```text
PAYMENT_PROVIDER=PAYOS
PUBLIC_API_URL=https://<local-tunnel-host>
```

Register `https://<local-tunnel-host>/api/storage/payments/payos/webhook` on the
development channel. Do not move the production channel webhook to a local
tunnel because that would divert production notifications.

## Verification

1. Startup logs show `[storage] Payment provider: PAYOS`.
2. Creating a paid purchase returns a `checkoutUrl` as `paymentUrl`.
3. A successful PayOS webhook changes the transaction to `COMPLETED` once.
4. Web returns to `/storage`; Mobile closes the auth session through its saved
   callback and polls `GET /api/storage/transactions/:orderRef`.
5. Admin payment management shows `PAYOS` while historical `VNPAY` rows remain
   readable.

Rotate any credential that has been pasted into chat, tickets, or screenshots
before using it in production.
