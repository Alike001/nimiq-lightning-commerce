# Nimlane — Nimiq Pay / Bitcoin Lightning merchant commerce

**Status: public no-spend preview, not a launched payment service.**

Public preview: https://nimlane-preview.onrender.com

## What works in the Neon-backed public preview

- Hosted storefront that opens in a browser and inside Nimiq Pay.
- Unpaid Blink merchant invoice generation and server-side order records in Neon PostgreSQL.
- Private order recovery across devices; only SHA-256 hashes of recovery tokens are stored in PostgreSQL.
- Read-only invoice status; delivery never unlocks in this preview.
- `/api/health` and `/api/config` endpoints to verify its status.

The cloud server **unconditionally forbids wallet payments and downloads**. Its
`network: mainnet` configuration refers to the *Bitcoin Lightning invoice network*,
not the active Nimiq Pay wallet. Nimiq Pay may separately show `testnet`. The
preview UI intentionally says `PREVIEW · NO PAYMENTS` to avoid this ambiguity.

## Start the cloud preview locally

```sh
npm ci
npm test
npm run build
# Create a private .env.neon.local with DATABASE_URL and other preview settings.
# Never commit it, print the connection string, or enable payment flags.
node --env-file=.env.neon.local neon-preview-server.mjs
```

Production hosting uses the same `neon-preview-server.mjs` with `HOST=0.0.0.0`
and Render's injected `PORT`. The current public preview has unpaid order
creation enabled; wallet execution and fulfillment are disabled. A GitHub push
does not automatically redeploy Render while its auto-deploy setting is off.

## Still to prove before any live launch

A real user-approved NIM → Bitcoin Lightning swap, an independently verified
merchant settlement, reliable automatic fulfillment, abuse/security review,
merchant onboarding and usable customer support. Nimiq support previously
reported Lightning payments unavailable on NIM testnet; that does **not** prove
the mainnet swap path works. Do not enable live payments to work around this.

## Earlier SQLite / BTCPay pilot (historical v0.3 documentation)

A single-merchant **Nimiq Pay Mini App** research-to-product iteration. A customer purchases a real, original digital resource from a Bitcoin Lightning merchant using a Nimiq Pay wallet. The merchant receives BTC over Lightning *if* the external swap succeeds. Our backend independently checks BTCPay settlement before releasing the resource.

**Current status: NO MAINNET / NO PUBLIC PURCHASING.** The underlying Fastspot testnet NIM → BTC-LN swap previously returned “Cannot swap”, with no wallet-history entry and an expired unpaid invoice. Do not claim end-to-end success, enable real-money mode, or bypass that gate. The sample $0.25 item may be below Fastspot's minimum; the minimum is not yet verified.

## What's implemented

- A responsive merchant storefront, pilot catalog, wallet status, order progress, and customer history.
- Real digital resource at `deliverables/merchant-operations-pack-v1.md`. This pack is original pilot content **not validated market demand**. Replace/add merchant-authored digital products and demonstrate demand before launch.
- Random 256-bit bearer recovery code and SHA-256 hashed token in SQLite. Users can copy the code and reopen an order on another device; anyone holding it can access the entitlement.
- A unique BTCPay invoice for each order, server-only API credentials, payment network checks, and durable SQLite order records.
- Signed webhook HMAC verification over the raw body, store and invoice binding, and independent BTCPay GET reconciliation. Replays are idempotent.
- Exactly-once entitlement creation (`fulfilled_at`) and downloadable resource gated on an *up-to-date* BTCPay `Settled` status, correct order/currency/amount, nonzero BTC-LN paid, and no payment from another rail.
- Optional wallet SDK call behind a disabled-by-default environment gate; the app cannot classify an ambiguous failure as confirmed rejection. An attempt is recorded on the backend **before** opening Nimiq Pay. No automatic retries.
- Local-only merchant operations CLI; **no exposed merchant admin UI**. Single merchant only.

## Install alongside the existing research lab

```bash
cd ~/Desktop/nim/nimiq-context
unzip -n ~/Downloads/nimiq-lightning-storefront-v03.zip -d .
cd apps/nimiq-lightning-commerce
npm install
npm test
npm run build
```

Use the existing private BTCPay credentials in `labs/lightning-btcpay-bridge/.env.local`. They must contain `BTCPAY_URL`, `BTCPAY_STORE_ID`, `BTCPAY_API_KEY`, and optionally `BTCPAY_WEBHOOK_SECRET`. Nothing from that secret file is included in this ZIP. Keep its permissions restricted (`chmod 600`). The start script reads the existing file; don't copy it into the web frontend.

The **old v0.2 SQLite database is left completely untouched**. This application has a **new** database at `apps/nimiq-lightning-commerce/data/commerce.sqlite`. Previous research orders and uncertain attempts remain in `labs/nimiq-lightning-checkout-alpha/data/orders.sqlite` and must be reconciled separately.

## Start safely

```bash
PORT=8790 ENABLE_ORDER_CREATION=0 ENABLE_WALLET_PAY=0 BITCOIN_NETWORK=testnet npm run serve
```

In another terminal:

```bash
curl -sS http://127.0.0.1:8790/api/config | python3 -m json.tool
curl -sS http://127.0.0.1:8790/api/catalog | python3 -m json.tool
npm run merchant:summary
```

Open `http://127.0.0.1:8790` on your laptop. Once you have confirmed the read-only frontend and are testing privately, you may restart the backend with `ENABLE_ORDER_CREATION=1` (keep `ENABLE_WALLET_PAY=0`) and create a genuine **unpaid** BTCPay research invoice. A new invoice may trigger an existing webhook; its destination must be updated to this new server URL before testing matching-order delivery. Do not expose it publicly with order creation enabled without additional authentication and abuse protections.

### Mobile Mini App testing

Cloudflare Quick Tunnels are temporary development infrastructure, not production hosting. If using one, with wallet payments OFF, run:

```bash
~/bin/cloudflared tunnel --protocol http2 --url http://127.0.0.1:8790
```

Copy the newly generated `https://...trycloudflare.com` root URL into Nimiq Pay → Mini Apps → Custom URL. Each tunnel has a *different hostname*. Check the `/api/config` response over HTTPS first. Remember: because the URL is public, default to order creation OFF.

### Local merchant operations

```bash
npm run merchant:orders
npm run merchant:summary
```

No merchant keys or secret values appear in these commands. They read the local database only; there is no merchant login or onboarding yet.

## Test claims and their limits

`npm test` covers local state and reconciliation, and exercises a real HTTP handler with a mocked BTCPay server. A mocked `Settled` invoice in an automated test is **not** evidence of BTC received. A BTCPay `InvoiceCreated` webhook is not a payment. The v0.2 real merchant webhook redelivery was reported green; there is no successful real Lightning settlement on record.

The research item's price is deliberately low. We have **not** validated Fastspot quote size, routing, or BTC-LN liquidity. A payment button is not a payment guarantee. Do not reattempt prior expired invoices. Do not sell mainnet goods from the public BTCPay testnet demo.

## Production gates

Before a real launch: production merchant-controlled BTC mainnet receiver with usable inbound capacity; Nimiq mainnet Fastspot quote and one explicitly approved low-value real transaction; verified Lightning receipt in BTCPay; secure merchant accounts and authentication; privacy/terms/refunds; production Postgres with backups, idempotency, monitoring and queue; reliable HTTPS deploy and stable webhook URL; full security review (including admin-manual-settlement and invoice-level proof of Lightning route); deliverable authenticity and customer support. Testnet is ineligible for a mainnet competition submission.

The app intentionally hard-gates mainnet flags and wallet payments. Don't set those merely to remove an error or meet a deadline.

Official references:
- https://www.nimiq.dev/mini-apps/features/bitcoin-lightning-payments
- https://docs.btcpayserver.org/Developers/api/
- https://docs.btcpayserver.org/Invoices/
