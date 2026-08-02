# Deploying storage packages + VNPay on Render

Checklist for taking the storage-package feature from local to a live Render
deployment. Everything here is configuration — no code changes are required.

## 1. Environment variables on the Render service

Add these under **Settings → Environment** on the backend service.

| Key | Value | Notes |
|---|---|---|
| `PUBLIC_API_URL` | `https://<your-service>.onrender.com` | **The one that usually gets forgotten.** Must be the absolute public origin of the API, HTTPS, no trailing slash. It is what builds `vnp_ReturnUrl`. |
| `VNP_TMN_CODE` | from the VNPay merchant portal | Presence of this + `VNP_HASH_SECRET` is what switches the provider from `MOCK` to `VNPAY`. |
| `VNP_HASH_SECRET` | from the VNPay merchant portal | Never commit this. Rotate it if it has ever been pasted into a chat, ticket or screenshot. |
| `VNP_URL` | `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` | Swap for the production endpoint when you go live for real. |
| `STORAGE_ORDER_TTL_MINUTES` | `15` | Drives both our expiry and `vnp_ExpireDate`, so they can never disagree. |
| `STORAGE_QUOTA_ENFORCED` | `true` | Set to `false` to disable quota blocking in seconds without a redeploy, if enforcement ever misbehaves in production. |
| `FRONTEND_URL` | `https://<your-web-app>` | Already required; the payment return redirects here for web clients. |
| `MOBILE_APP_SCHEME` | `aistudyhub` | Already required; used for the mobile deep link. |
| `ALLOW_EXPO_GO_RETURN_URL` | `true` only for Expo Go testing | Allows private-network `exp://` callbacks from Expo Go. Keep `false` for normal production/release builds. |

If `VNP_TMN_CODE` is set but `PUBLIC_API_URL` is missing or is not HTTPS, the
server **refuses to start** with a clear message. That is deliberate: a silent
misconfiguration would only surface at the first real payment.

## 2. Register the IPN URL in the VNPay merchant portal

Set the IPN (Instant Payment Notification) URL to:

```
https://<your-service>.onrender.com/api/storage/payments/vnpay/ipn
```

This is a server-to-server callback, so it must be publicly reachable — which is
exactly why it cannot work against `localhost`.

The `vnp_ReturnUrl` is sent per-request and needs no portal configuration.

## 3. Seed the packages on the production database

Run once against the production `MONGO_URI`, from a Render Shell or locally with
the production connection string:

```bash
npm run seed:storage-packages
npm run backfill:user-storage
```

- `seed:storage-packages` is idempotent. Display copy (name, description,
  features) is refreshed on every run; price and capacity are insert-only so a
  deliberate change is never reset.
- `backfill:user-storage` provisions a `UserStorage` row per existing user and
  reports anyone already over the Free quota. **Run it before enabling
  enforcement** so there are no surprises.

## 4. Schedule the background jobs

Two endpoints exist, both guarded by the `x-job-secret` header matching
`JOB_SECRET`. Add them to whatever scheduler you use (Render Cron Job,
cron-job.org, GitHub Actions):

| Endpoint | Suggested cadence | Purpose |
|---|---|---|
| `POST /api/jobs/reconcile-storage` | hourly | Recomputes used bytes from actual files, and clears reservations stranded by a crashed request. Skipping this is the one way quota can silently drift. |
| `POST /api/jobs/expire-storage-orders` | every 15 min | Marks abandoned orders `EXPIRED` so a late callback cannot revive them. |
| `POST /api/jobs/purge-trash` | daily | Pre-existing job; also what frees storage back to users. |

Example:

```bash
curl -X POST -H "x-job-secret: $JOB_SECRET" \
  https://<your-service>.onrender.com/api/jobs/reconcile-storage
```

## 5. Cold starts on the free tier

Render's free tier sleeps a service after roughly 15 minutes of inactivity, and
a cold start takes 30–60 seconds. VNPay's IPN can time out against a sleeping
service.

Three independent defences cover this, and all three are already in place:

1. VNPay retries the IPN on failure.
2. The browser return route settles the order too, using the same atomic
   conditional update — whichever arrives first wins, the other is a no-op.
3. Both clients poll `GET /api/storage/transactions/:orderRef` for up to 20
   seconds after the user returns.

You do not need to do anything for this, but it explains why a payment can be
confirmed even when the IPN never lands.

## 6. Verifying the deployment

1. Check the startup log says `[storage] Payment provider: VNPAY`. If it says
   `MOCK`, the credentials did not reach the service.
2. `GET /api/storage/packages` with a valid token returns three plans.
3. `POST /api/storage/reconcile` returns `drift: 0`.
4. Buy a plan end to end with a VNPay sandbox test card.
5. Check the transaction's **`settledBy`** field. `IPN` means the gateway
   reached your server, which is what proves the IPN URL in the portal is
   correct. `RETURN` means only the browser redirect closed the order — the
   payment still succeeded, but the IPN never landed, so fix the portal URL
   before relying on it. (`ipnReceivedAt` is set by both paths and cannot tell
   them apart.)

## 7. Going to real production payments

Sandbox credentials do not work against the live gateway. When you switch:

- Get production `vnp_TmnCode` / `vnp_HashSecret` from VNPay.
- Point `VNP_URL` at the production payment endpoint.
- Re-register the IPN URL on the production terminal.
- Move off the Render free tier, or IPN timeouts stop being a curiosity and
  start being lost revenue.
