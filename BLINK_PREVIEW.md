# Blink receive-only storefront preview (no spending)

This is an isolated backend for the existing frontend. It **never** calls Nimiq Pay to spend, does not enable downloads, and does not replace `server.mjs` or the BTCPay DB.

Requirements: Node 24.14+ as used in the research lab; previous Blink guard scripts and the existing `dist/` frontend (`npm run build`).

Run from `apps/nimiq-lightning-commerce`:

```sh
node --test tests/blink-preview-api.test.mjs
npm test
npm run build
PORT=8792 BLINK_USERNAME=alike BLINK_PREVIEW_SATS=1000 \
 ENABLE_BLINK_PREVIEW_ORDERS=1 ENABLE_WALLET_PAY=0 \
 node blink-preview-server.mjs
```

Open `http://127.0.0.1:8792` on the laptop (do NOT publish a public URL yet). The product price in preview is explicitly `1000 sats`, not a conversion of USD 0.25.

Click `Create order`. The server requests a genuine unpaid BTC mainnet Lightning invoice from the configured Blink address; stores the invoice, payee metadata hash, payment hash and verification URL in `data/blink-preview.sqlite`; and returns a private recovery code to the same browser. The full recovery code can be used to reopen the order. In preview mode **no checkout payment button or download is enabled**, including after a provider claim of settlement. No money moves.

`GET /api/config` responds with `previewOnly:true`, `walletEnabled:false`, `productionReady:false`; `GET /api/orders/{id}` with `X-Order-Token: <private-token>` independently checks the saved invoice via the Blink verification endpoint. `GET /api/orders/{id}/download` is always HTTP 403.

To switch back to the original BTCPay research server, stop this server and use the existing `npm run serve` with its existing environment, which this patch does not edit.

Remaining blockers: a stable backend and persistent database, security review, merchant/onboarding policy, invoice signature validation decision, live swap feasibility, and an explicitly approved paid mainnet settlement + delivery test.
