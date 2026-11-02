import {networkOfBolt11} from './core.mjs';
export function lightningInvoice(methods,network){
  if(!Array.isArray(methods))return null;
  const m=methods.find(x=>x?.paymentMethodId==='BTC-LN'&&x.activated===true);
  const bolt=String(m?.paymentLink||m?.destination||'').replace(/^lightning:/i,'').trim();
  return networkOfBolt11(bolt)===network?bolt:null;
}
export function settlementGate(invoice,methods,order,product){
  if(!invoice || !methods || !order || !product) return {ok:false,state:'REVIEW'};
  if(invoice.metadata?.orderId!==order.id || invoice.currency!==product.currency || String(invoice.amount)!==product.amount)
    return {ok:false,state:'MISMATCH'};
  const ln=methods.find(m=>m?.paymentMethodId==='BTC-LN'&&m.activated===true);
  if(!ln)return {ok:false,state:'NO_LIGHTNING'};
  if(invoice.status!=='Settled'||(invoice.additionalStatus && invoice.additionalStatus!=='None'))
    return {ok:false,state:invoice.status||'UNKNOWN'};
  // The API is authoritative; an on-chain-only payment is insufficient.
  if(!(Number(ln.paymentMethodPaid)>0))return {ok:false,state:'NO_LN_PAYMENT'};
  // Mixed on-chain + Lightning payments require manual reconciliation.
  if(methods.some(m=>m?.paymentMethodId!=='BTC-LN' && Number(m?.paymentMethodPaid||0)>0))return {ok:false,state:'MIXED_RAILS_REVIEW'};
  return {ok:true,state:'READY'};
}
export function validRecovery(value){return typeof value==='string' && /^NLC-[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(value)}
export function cleanError(err){const type=String(err?.type||'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,64)||'UNKNOWN';const code=Number.isSafeInteger(err?.code)?err.code:null;return {type,code}}
