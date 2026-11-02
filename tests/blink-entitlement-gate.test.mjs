import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {installEntitlementLedger} from '../blink-entitlement-gate.mjs';

function temp(){return mkdtempSync(join(tmpdir(),'nimlane-entitlement-'))}

test('entitlement is only minted with verified proof and is replay-idempotent',()=>{
 const dir=temp();const db=new DatabaseSync(join(dir,'db.sqlite'));
 try{
  db.exec('CREATE TABLE blink_preview_orders(id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO blink_preview_orders VALUES(?)').run('NLC-test');
  const ledger=installEntitlementLedger(db),row={id:'NLC-test',sku:'merchant-operations-pack-v1',payment_hash:'a'.repeat(64)};
  assert.equal(ledger.grantOnce(row,false),null);
  assert.equal(ledger.get(row),null);
  const first=ledger.grantOnce(row,true,1234);
  assert.equal(first.granted_at,1234);
  assert.equal(ledger.grantOnce(row,true,9999).granted_at,1234);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blink_preview_entitlements').get().n,1);
  assert.equal(ledger.get({...row,payment_hash:'b'.repeat(64)}),null);
  assert.equal(ledger.get({...row,sku:'different'}),null);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});

// An entirely local mock: no real Lightning wallet or provider transaction.
const ABC='qpzry9x8gf2tvdw0s3jn54khce6mua7l', GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
function poly(arr){let c=1;for(const n of arr){const t=c>>>25;c=((c&0x1ffffff)<<5)^n;for(let i=0;i<5;i++)if((t>>>i)&1)c^=GEN[i]}return c>>>0}
function words(buf){const a=[];let v=0,b=0;for(const x of buf){v=(v<<8)|x;b+=8;while(b>=5){b-=5;a.push((v>>>b)&31)}}if(b)a.push((v<<(5-b))&31);return a}
function tag(c,bytes){const a=words(bytes);return [ABC.indexOf(c),a.length>>>5,a.length&31,...a]}
function bolt(metadata,preimage){const hrp='lnbc10000n';let n=Math.floor(Date.now()/1000),ts=[];for(let i=0;i<7;i++){ts.unshift(n%32);n=Math.floor(n/32)}let a=ts.concat(tag('p',createHash('sha256').update(preimage).digest()),tag('s',Buffer.alloc(32,9)),tag('h',createHash('sha256').update(metadata).digest()));a.push(ABC.indexOf('x'),0,3,0,2,0);const sig=Buffer.alloc(65,4);sig[64]=1;a.push(...words(sig));const pre=[...hrp].map(x=>x.charCodeAt(0)>>>5).concat([0],[...hrp].map(x=>x.charCodeAt(0)&31));const m=poly(pre.concat(a,[0,0,0,0,0,0]))^1;return hrp+'1'+a.concat(Array.from({length:6},(_,i)=>(m>>>(5*(5-i)))&31)).map(x=>ABC[x]).join('')}

test('mock settlement cannot unlock before valid proof, unlocks once after valid proof',async()=>{
 const dir=temp(),originalFetch=globalThis.fetch;
 const keys=['NODE_ENV','BLINK_PREVIEW_DATA_DIR','BLINK_USERNAME','BLINK_PREVIEW_SATS','ENABLE_BLINK_PREVIEW_ORDERS','ENABLE_WALLET_PAY','ENABLE_BLINK_TEST_FULFILLMENT'];
 const oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{NODE_ENV:'test',BLINK_PREVIEW_DATA_DIR:dir,BLINK_USERNAME:'alike',BLINK_PREVIEW_SATS:'1000',ENABLE_BLINK_PREVIEW_ORDERS:'1',ENABLE_WALLET_PAY:'0',ENABLE_BLINK_TEST_FULFILLMENT:'1'});
 const metadata=JSON.stringify([['text/plain','Pay to alike@blink.sv'],['text/identifier','alike@blink.sv']]);
 const preimage=Buffer.alloc(32,7),invoice=bolt(metadata,preimage);
 let result={settled:false};
 globalThis.fetch=async(input)=>{
  const u=String(input);
  if(u==='https://blink.sv/.well-known/lnurlp/alike')return new Response(JSON.stringify({tag:'payRequest',callback:'https://lnurl.blink.sv/lnurlp/blink.sv/alike/invoice',minSendable:1000,maxSendable:50000000000,metadata}),{status:200});
  if(u.startsWith('https://lnurl.blink.sv/lnurlp/blink.sv/alike/invoice?'))return new Response(JSON.stringify({pr:invoice,verify:'https://lnurl.blink.sv/verify/opaque'}),{status:200});
  if(u==='https://lnurl.blink.sv/verify/opaque')return new Response(JSON.stringify(result),{status:200});
  throw Error('Unexpected network request: '+u);
 };
 let server,db;
 try{
  ({server,db}=await import('../blink-preview-server.mjs?entitlement-case=1'));
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=(path,opts)=>originalFetch(origin+path,opts);
  const config=await (await call('/api/config')).json();assert.equal(config.testDeliveryEnabled,true);assert.equal(config.walletEnabled,false);assert.equal(config.productionReady,false);
  const r=await call('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:'merchant-operations-pack-v1'})});
  assert.equal(r.status,201);const order=await r.json();
  const path=`/api/orders/${order.orderId}`,headers={'X-Order-Token':order.orderToken};
  assert.equal((await call(path+'/download',{headers})).status,403,'unpaid is blocked');
  result={settled:true,pr:invoice,preimage:Buffer.alloc(32,3).toString('hex')};
  assert.equal((await call(path+'/download',{headers})).status,403,'forged preimage blocked');
  result={settled:true,pr:invoice+'forged',preimage:preimage.toString('hex')};
  assert.equal((await call(path+'/download',{headers})).status,403,'wrong invoice blocked');
  result={settled:true,pr:invoice,preimage:preimage.toString('hex')};
  const first=await call(path+'/download',{headers});assert.equal(first.status,200);assert.match(await first.text(),/Merchant|merchant/);
  assert.equal((await call(path+'/download')).status,404,'download without bearer token is rejected');
  assert.equal((await call(path+'/attempt',{method:'POST',headers})).status,403,'wallet execution remains blocked');
  assert.equal((await call(path+'/download',{method:'POST',headers})).status,405);
  const receipt=await (await call(path+'/receipt',{headers})).json();assert.equal(receipt.delivered,true);
  const row=db.prepare('SELECT COUNT(*) n FROM blink_preview_entitlements WHERE order_id=?').get(order.orderId);assert.equal(row.n,1,'repeated downloads have one entitlement');
  result={settled:false};
  assert.equal((await call(path+'/download',{headers})).status,200,'durable prior proof remains valid');
 }finally{
  globalThis.fetch=originalFetch;
  if(server?.listening)await new Promise(ok=>server.close(ok));
  db?.close();rmSync(dir,{recursive:true,force:true});
  for(const k of keys){if(oldEnv[k]===undefined)delete process.env[k];else process.env[k]=oldEnv[k]}
 }
});
