// Database-only Neon persistence for the non-financial Blink preview.
// All queries use positional parameters. Never send DATABASE_URL to the browser.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS nimlane_blink_preview_orders (
 id TEXT PRIMARY KEY,
 token_hash CHAR(64) NOT NULL UNIQUE,
 sku TEXT NOT NULL,
 amount_sats INTEGER NOT NULL CHECK (amount_sats > 0 AND amount_sats <= 50000000),
 invoice TEXT NOT NULL,
 verify_url TEXT NOT NULL,
 payment_hash CHAR(64) NOT NULL UNIQUE,
 metadata_sha256 CHAR(64) NOT NULL,
 issued_at BIGINT NOT NULL,
 expires_at BIGINT NOT NULL,
 last_status TEXT NOT NULL DEFAULT 'NEW',
 checked_at BIGINT
);
CREATE INDEX IF NOT EXISTS nimlane_blink_preview_issued_idx ON nimlane_blink_preview_orders (issued_at);
CREATE TABLE IF NOT EXISTS nimlane_blink_preview_entitlements (
 order_id TEXT PRIMARY KEY REFERENCES nimlane_blink_preview_orders(id),
 sku TEXT NOT NULL,
 payment_hash CHAR(64) NOT NULL UNIQUE,
 granted_at BIGINT NOT NULL
);
`;

// No code in the public cloud preview writes to the entitlement table.
export async function initPreviewSchema(pool) {
  // The schema contains only idempotent DDL and never drops old data.
  await pool.query(SCHEMA);
}

export function createNeonPreviewStore(pool) {
  if (!pool || typeof pool.query !== 'function') throw Error('Database query client required');
  return {
    async countRecent(after) {
      const {rows}=await pool.query('SELECT COUNT(*)::integer AS n FROM nimlane_blink_preview_orders WHERE issued_at > $1',[after]);
      return Number(rows[0].n);
    },
    async create(row, after, cap=15) {
      // Atomic capacity check in a single statement. Only a preview spam guard;
      // PostgreSQL per-IP and durable global rate limiting can be added later.
      const params=[row.id,row.token_hash,row.sku,row.amount_sats,row.invoice,row.verify_url,
        row.payment_hash,row.metadata_sha256,row.issued_at,row.expires_at,after,cap];
      const {rows}=await pool.query(`INSERT INTO nimlane_blink_preview_orders
        (id,token_hash,sku,amount_sats,invoice,verify_url,payment_hash,metadata_sha256,issued_at,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        WHERE (SELECT COUNT(*) FROM nimlane_blink_preview_orders WHERE issued_at > $11) < $12
        RETURNING id`,params);
      return rows.length===1;
    },
    async get(id,tokenHash) {
      const {rows}=await pool.query('SELECT * FROM nimlane_blink_preview_orders WHERE id=$1 AND token_hash=$2',[id,tokenHash]);
      const r=rows[0];
      if(!r)return null;
      // Postgres BIGINT is returned as string by node-postgres.
      return {...r,issued_at:Number(r.issued_at),expires_at:Number(r.expires_at),checked_at:r.checked_at==null?null:Number(r.checked_at)};
    },
    async updateStatus(id,state,checkedAt) {
      await pool.query('UPDATE nimlane_blink_preview_orders SET last_status=$1,checked_at=$2 WHERE id=$3',[state,checkedAt,id]);
    },
    async checkReady() {
      const {rows}=await pool.query('SELECT 1 AS ok');return rows[0]?.ok===1;
    }
  };
}
