import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const tokenHash = s=>createHash('sha256').update(s).digest('hex');
export function openDb(root){
 mkdirSync(join(root,'data'),{recursive:true});
 const db=new DatabaseSync(join(root,'data','commerce.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS orders(
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, sku TEXT NOT NULL,
 invoice_id TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL,
 attempt_status TEXT, attempt_type TEXT, attempt_code INTEGER, swap_id TEXT, tx_hash TEXT,
 last_merchant_status TEXT, checked_at INTEGER, fulfilled_at INTEGER,
 delivery_count INTEGER NOT NULL DEFAULT 0 CHECK(delivery_count>=0)
 );
 CREATE TABLE IF NOT EXISTS webhook_events(delivery_id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,type TEXT NOT NULL,verified_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at);
 `);
 return db;
}
export function recordFulfillment(db,id,now){
 // Synchronous and atomic. Entitlement can never be recorded twice.
 return db.prepare('UPDATE orders SET fulfilled_at=? WHERE id=? AND fulfilled_at IS NULL').run(now,id).changes===1;
}
