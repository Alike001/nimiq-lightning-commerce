import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
// Valid structural BOLT11 fixture, NOT a signed/spendable invoice; mocks never touch wallets.
const ABC='qpzry9x8gf2tvdw0s3jn54khce6mua7l',GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
function poly(arr){let c=1;for(let n of arr){let t=c>>>25;c=((c&0x1ffffff)<<5)^n;for(let i=0;i<5;i++)if((t>>>i)&1)c^=GEN[i]}return c>>>0}
function words(buf){let a=[],v=0,b=0;for(let x of buf){v=(v<<8)|x;b+=8;while(b>=5){b-=5;a.push((v>>>b)&31)}}if(b)a.push((v<<(5-b))&31);return a}
function tag(c,bytes){let a=words(bytes);return [ABC.indexOf(c),a.length>>>5,a.length&31,...a]}
function bolt(metadata,preimage){const hrp='lnbc10000n';let n=Math.floor(Date.now()/1000),ts=[];for(let i=0;i<7;i++){ts.unshift(n%32);n=Math.floor(n/32)}const hash=createHash('sha256').update(preimage).digest();let a=ts.concat(tag('p',hash),tag('s',Buffer.alloc(32,9)),tag('h',createHash('sha256').update(metadata).digest()));a.push(ABC.indexOf('x'),0,3,0,2,0);const sig=Buffer.alloc(65,4);sig[64]=1;a.push(...words(sig));const pre=[...hrp].map(x=>x.charCodeAt(0)>>>5).concat([0],[...hrp].map(x=>x.charCodeAt(0)&31));let m=poly(pre.concat(a,[0,0,0,0,0,0]))^1;return hrp+'1'+a.concat(Array.from({length:6},(_,i)=>(m>>>(5*(5-i)))&31)).map(x=>ABC[x]).join('')}
const metadata=JSON.stringify([['text/plain','Pay to alike@blink.sv'],['text/identifier','alike@blink.sv']]);
const preimage=Buffer.alloc(32,7),invoice=bolt(metadata,preimage);
test('Blink storefront preview: real order API, recovery, unpaid guard, forged proof rejection, verified proof still no download', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nimlane-blink-preview-'));
 const oldFetch=globalThis.fetch;
 const oldEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('BLINK_')||k==='NODE_ENV'||k==='ENABLE_WALLET_PAY'));
 Object.assign(process.env,{NODE_ENV:'test',BLINK_PREVIEW_DATA_DIR:dir,BLINK_USERNAME:'alike',BLINK_PREVIEW_SATS:'1000',ENABLE_BLINK_PREVIEW_ORDERS:'1',ENABLE_WALLET_PAY:'0'});
 let status={settled:false},invoiceCalls=0;
 globalThis.fetch=async(input,options={})=>{
  const u=String(input);
  if(u==='https://blink.sv/.well-known/lnurlp/alike')return new Response(JSON.stringify({tag:'payRequest',callback:'https://lnurl.blink.sv/lnurlp/blink.sv/alike/invoice',minSendable:1000,maxSendable:50000000000,metadata}),{status:200});
  if(u.startsWith('https://lnurl.blink.sv/lnurlp/blink.sv/alike/invoice?')){invoiceCalls++;return new Response(JSON.stringify({pr:invoice,verify:'https://lnurl.blink.sv/verify/opaque'}),{status:200})}
  if(u==='https://lnurl.blink.sv/verify/opaque')return new Response(JSON.stringify(status),{status:200});
  throw Error('Unexpected external fetch '+u);
 };
 const {server,db}=await import('../blink-preview-server.mjs?case=1');
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  const get=async(path,headers={})=>oldFetch(origin+path,{headers});
  const cfg=await (await get('/api/config')).json();assert.equal(cfg.walletEnabled,false);assert.equal(cfg.previewOnly,true);assert.equal(cfg.network,'mainnet');
  const list=await (await get('/api/catalog')).json();assert.equal(list.products[0].amount,'1000');assert.equal(list.products[0].currency,'sats');
  const newOrder=await oldFetch(origin+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'merchant-operations-pack-v1'})});
  assert.equal(newOrder.status,201);const order=await newOrder.json();assert.equal(invoiceCalls,1);assert.equal(order.fulfilled,false);assert.equal(order.paymentAllowed,false);assert.equal(order.state,'NEW');assert.equal(order.currency,'sats');
  const path=`/api/orders/${order.orderId}`,headers={'X-Order-Token':order.orderToken};
  assert.equal((await get(path)).status,404); // no credential, no order details
  assert.equal((await get(path,headers)).status,200);
  assert.equal((await get(path+'/download',headers)).status,403);
  assert.equal((await oldFetch(origin+path+'/attempt',{method:'POST',headers})).status,403);
  const receipt=await (await get(path+'/receipt',headers)).json();assert.equal(receipt.delivered,false);assert.equal(receipt.lightningSettled,false);
  status={settled:true,pr:invoice,preimage:Buffer.alloc(32,3).toString('hex')};
  const forged=await (await get(path,headers)).json();assert.equal(forged.fulfilled,false);assert.equal(forged.merchantStatus,'CHECK_UNAVAILABLE');
  status={settled:true,pr:invoice,preimage:preimage.toString('hex')};
  const verified=await (await get(path,headers)).json();assert.equal(verified.settlementProofObserved,true);assert.equal(verified.fulfilled,false);assert.equal(verified.downloadAvailable,false);assert.equal(verified.state,'SETTLED_PROOF_REVIEW');
  assert.equal((await get(path+'/download',headers)).status,403); // deliberately still locked
  const row=db.prepare('SELECT * FROM blink_preview_orders WHERE id=?').get(order.orderId);assert.equal(row.payment_hash,createHash('sha256').update(preimage).digest('hex'));assert.equal(row.metadata_sha256,createHash('sha256').update(metadata).digest('hex'));
  // New attempt to bind SAME payment hash to another order is refused by unique constraint.
  const reused=await oldFetch(origin+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'merchant-operations-pack-v1'})});assert.equal(reused.status,502);
 }finally{
  globalThis.fetch=oldFetch;await new Promise(ok=>server.close(ok));db.close();rmSync(dir,{recursive:true,force:true});
  for(const k of ['NODE_ENV','BLINK_PREVIEW_DATA_DIR','BLINK_USERNAME','BLINK_PREVIEW_SATS','ENABLE_BLINK_PREVIEW_ORDERS','ENABLE_WALLET_PAY']){if(k in oldEnv)process.env[k]=oldEnv[k];else delete process.env[k]}
 }
});
