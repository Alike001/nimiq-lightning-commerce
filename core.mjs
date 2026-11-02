// Reusable, no-key product and payment rules. No wallet interaction.
export const PRODUCT = Object.freeze({
  sku:'lightning-checkout-research',
  name:'Lightning Commerce — Research Checkout',
  description:'A $0.25 test order used to validate a Nimiq-funded merchant Lightning purchase.',
  amount:'0.25', currency:'USD',
});
export function isInvoiceId(value){ return typeof value==='string' && /^[A-Za-z0-9_-]{5,150}$/.test(value) }
export function networkOfBolt11(value){
  if(typeof value!=='string') return null;
  const v=value.trim().replace(/^lightning:/i,'').toLowerCase();
  if(/^lnbcrt[0-9]/.test(v)) return 'regtest';
  if(/^lntb[0-9]/.test(v)) return 'testnet';
  if(/^lnbc[0-9]/.test(v)) return 'mainnet';
  return null;
}
export function lightningMethod(methods,expectedNetwork){
  if(!Array.isArray(methods)) return null;
  const method=methods.find(m=>m?.paymentMethodId==='BTC-LN' && m.activated===true);
  if(!method) return null;
  const invoice=String(method.paymentLink||method.destination||'').trim().replace(/^lightning:/i,'');
  if(networkOfBolt11(invoice)!==expectedNetwork) return null;
  return invoice;
}
export function merchantVerdict(invoice, methods, orderId){
  if(!invoice || invoice.metadata?.orderId!==orderId || invoice.currency!=='USD' || String(invoice.amount)!==PRODUCT.amount)
    return {state:'REVIEW', safeToFulfill:false};
  const lightning = Array.isArray(methods) ? methods.find(m=>m?.paymentMethodId==='BTC-LN') : null;
  if(!lightning?.activated) return {state:'REVIEW',safeToFulfill:false};
  const status=invoice.status;
  if(status==='Expired'||status==='Invalid') return {state:status.toUpperCase(),safeToFulfill:false};
  if(status==='New'||status==='Processing') return {state:status.toUpperCase(),safeToFulfill:false};
  if(status!=='Settled') return {state:'VERIFYING',safeToFulfill:false};
  if(invoice.additionalStatus && invoice.additionalStatus!=='None') return {state:'REVIEW',safeToFulfill:false};
  // A settled BTC-CHAIN payment is NOT a settled Lightning payment.
  if(!(Number(lightning.paymentMethodPaid)>0)) return {state:'REVIEW',safeToFulfill:false};
  return {state:'SETTLED',safeToFulfill:true};
}
