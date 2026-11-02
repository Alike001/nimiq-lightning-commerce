// No-spend diagnostic. This module performs no wallet or network calls.
// Merely seeing an SDK method or invoice does not prove a payable route.
export function assessReadiness({hostNetwork,providerAvailable=false,lightningMethodExposed=false,previewOnly=true,walletEnabled=false,order=null}={}) {
 const network=hostNetwork==='mainnet'?'mainnet':hostNetwork==='testnet'?'testnet':'unknown';
 const issued=typeof order?.invoice==='string'&&/^lnbc/i.test(order.invoice);
 const proof=order?.settlementProofObserved===true;
 const networkMessage=network==='mainnet'?'Nimiq Pay mainnet detected (not a payment test)'
  :network==='testnet'?'Nimiq Pay testnet detected; mainnet Lightning invoice is not payable here'
  :'Network not independently detected in this session';
 const methodMessage=!providerAvailable?'Nimiq Pay provider unavailable'
  :lightningMethodExposed?'Method exposed; swap, quote, fees and execution NOT tested'
  :'Lightning payment method not exposed by this wallet host';
 const invoiceMessage=!order?'No order selected; no invoice examined'
  :issued?'Bitcoin mainnet invoice present; not proof of wallet payability or BTC receipt'
  :'No current mainnet Lightning invoice available';
 const settlementMessage=proof?'Merchant-side proof observed; preview delivery remains locked'
  :'No independently verified Lightning settlement for this order';
 const checkoutMessage=(previewOnly||!walletEnabled)?'DISABLED: no wallet payments or delivery in public preview'
  :'NOT CLEARED: routing, real swap and merchant settlement not independently proven';
 return {network:networkMessage,method:methodMessage,invoice:invoiceMessage,settlement:settlementMessage,checkout:checkoutMessage,clearedForLivePayment:false};
}
