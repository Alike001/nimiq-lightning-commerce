// Experimental entitlement ledger for the Blink storefront.
// This is called ONLY after the caller has independently validated the LUD-21
// proof and matched the exact BOLT11 invoice and payment hash for this order.
// The preview server NEVER activates this for real customers.
export function installEntitlementLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS blink_preview_entitlements (
    order_id TEXT NOT NULL PRIMARY KEY,
    sku TEXT NOT NULL,
    payment_hash TEXT NOT NULL UNIQUE,
    granted_at INTEGER NOT NULL,
    FOREIGN KEY(order_id) REFERENCES blink_preview_orders(id)
  )`);
  const find = db.prepare('SELECT order_id,sku,payment_hash,granted_at FROM blink_preview_entitlements WHERE order_id=?');
  const grant = db.prepare(`INSERT OR IGNORE INTO blink_preview_entitlements
    (order_id,sku,payment_hash,granted_at) VALUES (?,?,?,?)`);
  function get(order) {
    if (!order?.id) return null;
    const result = find.get(order.id);
    // The ledger alone is not a grant; it must remain bound to this exact order.
    if (!result || result.payment_hash !== order.payment_hash || result.sku !== order.sku) return null;
    return result;
  }
  function grantOnce(order, proofWasCryptographicallyVerified, at=Math.floor(Date.now()/1000)) {
    if (proofWasCryptographicallyVerified !== true) return null;
    if (!order?.id || !order?.payment_hash || !order?.sku || !Number.isSafeInteger(at)) throw Error('Invalid entitlement input');
    // Insert-or-ignore makes concurrent/replayed settled events idempotent.
    grant.run(order.id,order.sku,order.payment_hash,at);
    return get(order);
  }
  return {get,grantOnce};
}
