# Nimlane — Neon PostgreSQL cloud preview (v0.6)

This is **not** a live payment checkout. It is an additive receive-only Blink preview for durable orders on Neon. The existing SQLite preview, BTCPay experiments, and local research database are left unchanged.

## Verified environment

- Neon project: `nimlane-preview` in Frankfurt (`aws-eu-central-1`), database `neondb`.
- Source: `neon-preview-server.mjs` + `neon-preview-app.mjs` + `neon-preview-store.mjs`.
- Preview customer orders have unique `NLC-...` IDs, SHA-256-hashed recovery tokens, bound invoices and private receipts.
- Wallet payments **OFF**. Production fulfillment **OFF**. Webhooks **OFF**. No real-money transaction or delivery is enabled.
- `neon-preview-server.mjs` fails to start if any enable-payment/fulfillment flag is set, or when the secure Neon URL is missing.

## 1. Install the Node Postgres dependency

```
cd ~/Desktop/nim/nimiq-context/apps/nimiq-lightning-commerce
npm install pg
npm test
npm run build
```

`npm install pg` will update the local `package.json` and lockfile. Review those staged changes before committing.

## 2. Retrieve your Neon DATABASE_URL privately

In https://console.neon.tech choose project `nimlane-preview`, click **Connect**, choose branch `production`, database `neondb`, and use the pooled connection string with `sslmode=require`. Store it only in the backend environment. Never paste it into chat, source code, screenshots, Git, or browser JavaScript.

Create `apps/nimiq-lightning-commerce/.env.neon.local` (already ignored via `.env*`):

```dotenv
# PRIVATE — never commit this file
DATABASE_URL=postgresql://<role>:<password>@<endpoint>-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
BLINK_USERNAME=alike
BLINK_PREVIEW_SATS=1000
ENABLE_BLINK_PREVIEW_ORDERS=1
ENABLE_WALLET_PAY=0
HOST=127.0.0.1
PORT=8794
```

Use the exact Neon-generated connection string, **not** the example above. The app will never expose it through `/api/config`.

## 3. Preview schema (already created in Neon)

```
node --env-file=.env.neon.local scripts/init-neon-db.mjs
```

These tables were already created in your `nimlane-preview` Neon project via the connected database service. The command is optional and safe to re-run: it creates them if absent and **does not** import or erase SQLite data. The entitlements table exists only as a future schema slot. This preview does not write entitlements.

Check in Neon SQL Editor, using read-only SQL:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname='public' AND tablename LIKE 'nimlane_blink_preview_%'
ORDER BY tablename;
```

## 4. Start the cloud-mode preview locally

```
node --env-file=.env.neon.local neon-preview-server.mjs
```

Open http://127.0.0.1:8794/ . Confirm `/api/config` shows `walletEnabled:false`, `testDeliveryEnabled:false`, `productionReady:false`. If the original SQLite preview is using port 8792, it can remain running separately.

Create **one** new preview order. Copy its recovery code to a private place. Restart `neon-preview-server.mjs`, open an Incognito window at port 8794, and recover the same order. It should remain unpaid and undeliverable. Do not share the recovery code with anyone.

## 5. Deploy to Render Free (only after Git and smoke tests)

Set up a Render **Web Service** from your public repository with:

- Region: Frankfurt; Instance: Free.
- Build command: `npm ci && npm run build`.
- Start command: `node neon-preview-server.mjs`.
- Environment: `DATABASE_URL` (private pooled Neon URL), `BLINK_USERNAME=alike`, `BLINK_PREVIEW_SATS=1000`, `ENABLE_BLINK_PREVIEW_ORDERS=1`, `ENABLE_WALLET_PAY=0`, `HOST=0.0.0.0`.
- Use Render's automatically supplied `PORT`; don't override it unless necessary.

**Limits:** Render Free sleeps when inactive and is not reliable for final financial processing. Payment execution is intentionally absent from this preview, so it's safe to use for testing only. Neon must be available and can also scale down. Production requires stronger reliability, monitoring, transaction recovery and real payment verification.

## 6. Before first public Git push

```
git add -A
git diff --cached --check
git diff --cached --name-only
```

Check staged filenames **and file contents** for `DATABASE_URL`, API keys, wallet secrets, private recovery codes and raw databases. Use `.gitignore` to keep `.env.neon.local`, `.env.local`, `data/` and `*.sqlite*` out of Git. Never share a printed secret with a reviewer or ChatGPT.

This mode has no merchant login or multi-tenant isolation. Do not publish it as a production merchant platform.
