import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHmac} from 'node:crypto';
const originalFetch=globalThis.fetch;
test('real HTTP flow: no payment, forged webhook denied, verified Lightning unlocks once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nimiq-commerce-api-'));
 Object.assign(process.env,{NODE_ENV:'test',BTCPAY_URL:'https://mock-merchant.test',BTCPAY_STORE_ID:'store-a',BTCPAY_API_KEY:'test-key',BTCPAY_WEBHOOK_SECRET:'test-webhook-secret',ENABLE_ORDER_CREATION:'1',ENABLE_WALLET_PAY:'0',BITCOIN_NETWORK:'testnet',DATA_DIR:dir});
 let invoiceStatus='New',lightningPaid='0',lastOrderId='',invoiceCount=0;
 globalThis.fetch=async (input,options={})=>{
  const url=String(input);
  if(!url.startsWith('https://mock-merchant.test'))return originalFetch(input,options);
  const path=new URL(url).pathname;
  if(path==='/api/v1/stores/store-a/invoices' && options.method==='POST'){
    lastOrderId=JSON.parse(options.body).metadata.orderId;invoiceCount++;
    return new Response(JSON.stringify({id:'invoice-unique-123'}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(path==='/api/v1/invoices/invoice-unique-123')return new Response(JSON.stringify({id:'invoice-unique-123',metadata:{orderId:lastOrderId},amount:'0.25',currency:'USD',status:invoiceStatus,additionalStatus:'None'}),{status:200,headers:{'Content-Type':'application/json'}});
  if(path==='/api/v1/invoices/invoice-unique-123/payment-methods')return new Response(JSON.stringify([{paymentMethodId:'BTC-LN',activated:true,paymentMethodPaid:lightningPaid,paymentLink:'lntb200n1fakeinvoice'}]),{status:200,headers:{'Content-Type':'application/json'}});
  return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
 };
 const {server,db}=await import('../server.mjs?integration=1');
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
   const created=await originalFetch(`${origin}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'merchant-operations-pack-v1'})});
   assert.equal(created.status,201);const item=await created.json();assert.equal(invoiceCount,1);assert.equal(item.fulfilled,false);assert.equal(item.orderId,lastOrderId);
   const orderPath=`${origin}/api/orders/${item.orderId}`;const auth={'X-Order-Token':item.orderToken};
   assert.equal((await originalFetch(`${orderPath}/download`,{headers:auth})).status,403);
   assert.equal((await originalFetch(orderPath)).status,404);
   const event={deliveryId:'delivery-123',invoiceId:'invoice-unique-123',type:'InvoiceSettled',storeId:'store-a'};
   const raw=JSON.stringify(event);
   const webhook=`${origin}/api/webhooks/btcpay`;
   assert.equal((await originalFetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},body:raw})).status,401);
   const signature='sha256='+createHmac('sha256','test-webhook-secret').update(raw).digest('hex');
   const send=()=>originalFetch(webhook,{method:'POST',headers:{'Content-Type':'application/json','BTCPay-Sig':signature},body:raw});
   assert.equal((await send()).status,200);
   assert.equal(db.prepare('SELECT fulfilled_at FROM orders WHERE id=?').get(item.orderId).fulfilled_at,null);
   invoiceStatus='Settled';lightningPaid='0.00000321';
   // A genuine independent GET also completes entitlement, even when a webhook was missed.
   const detail=await originalFetch(orderPath,{headers:auth});assert.equal(detail.status,200);assert.equal((await detail.json()).fulfilled,true);
   assert.equal((await originalFetch(`${orderPath}/download`,{headers:auth})).status,200);
   assert.equal((await send()).status,200); // duplicate delivery stays idempotent
   const row=db.prepare('SELECT fulfilled_at,delivery_count FROM orders WHERE id=?').get(item.orderId);
   assert.equal(typeof row.fulfilled_at,'number');assert.equal(row.delivery_count,1);
 }finally{await new Promise(ok=>server.close(ok));db.close();globalThis.fetch=originalFetch;rmSync(dir,{recursive:true,force:true})}
});
