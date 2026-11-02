import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createNeonPreviewHandler} from '../neon-preview-app.mjs';
import {createNeonPreviewStore,SCHEMA} from '../neon-preview-store.mjs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
function fakeStore(){
 const map=new Map(); let seq=0;
 return {map,
  async checkReady(){return true},
  async create(row){seq++;if(seq>15)return false;for(const v of map.values())if(v.payment_hash===row.payment_hash)throw Error('Duplicate invoice');map.set(row.id,row);return true},
  async get(id,hash){const r=map.get(id);return r?.token_hash===hash?r:null},
  async updateStatus(id,status,checked){const r=map.get(id);if(r){r.last_status=status;r.checked_at=checked}},
 };
}
function handlers(store,status={settled:false,reason:'NOT_SETTLED'},opts={}){
 return createNeonPreviewHandler({store,root,username:'alike',sats:1000,ordersEnabled:true,
  issue:async() =>({invoice:'lnbc-fixture',metadata:'merchant-metadata',verifyUrl:'https://lnurl.blink.sv/verify/a'}),
  inspect:()=>({paymentHash:createHash('sha256').update(String(Math.random())).digest('hex'),timestampSeconds:1730000000,expirySeconds:3600}),
  statusCheck:async()=>status,clock:()=>1730001000,...opts});
}
async function withServer(handler,fn){const s=createServer(handler);await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const origin=`http://127.0.0.1:${s.address().port}`;try{return await fn(origin)}finally{await new Promise(ok=>s.close(ok))}}
const post=(u,sku)=>fetch(u+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku})});
const sku='merchant-operations-pack-v1';

test('cloud preview creates a real server-side order and does not enable payments',async()=>{
 const store=fakeStore();await withServer(handlers(store),async base=>{
  const cfg=await (await fetch(base+'/api/config')).json();
  assert.equal(cfg.walletEnabled,false);assert.equal(cfg.productionReady,false);assert.equal(cfg.testDeliveryEnabled,false);
  assert.equal((await fetch(base+'/api/health')).status,200);
  const res=await post(base,sku);assert.equal(res.status,201);const order=await res.json();
  assert.equal(order.state,'NEW');assert.equal(order.amount,'1000');assert.equal(order.paymentAllowed,false);
  assert.equal(order.downloadAvailable,false);assert.equal(order.fulfilled,false);
  assert.equal(store.map.size,1);assert.equal(store.map.get(order.orderId).token_hash,createHash('sha256').update(order.orderToken).digest('hex'));
  assert.equal((await fetch(base+'/api/orders/'+order.orderId)).status,404);
  assert.equal((await fetch(base+'/api/orders/'+order.orderId,{headers:{'X-Order-Token':'0'.repeat(64)}})).status,404);
  const h={'X-Order-Token':order.orderToken};
  assert.equal((await fetch(base+'/api/orders/'+order.orderId,{headers:h})).status,200);
  assert.equal((await fetch(base+'/api/orders/'+order.orderId+'/download',{headers:h})).status,403);
  assert.equal((await fetch(base+'/api/orders/'+order.orderId+'/attempt',{method:'POST',headers:h})).status,403);
  const rec=await (await fetch(base+'/api/orders/'+order.orderId+'/receipt',{headers:h})).json();assert.equal(rec.delivered,false);
 });
});
test('order recovered after handler restart with shared persistent store',async()=>{
 const store=fakeStore();let order;
 await withServer(handlers(store),async u=>{order=await (await post(u,sku)).json()});
 await withServer(handlers(store),async u=>{const r=await fetch(u+'/api/orders/'+order.orderId,{headers:{'X-Order-Token':order.orderToken}});assert.equal(r.status,200);assert.equal((await r.json()).orderId,order.orderId)});
});
test('even a valid mocked proof cannot unlock cloud delivery',async()=>{
 const store=fakeStore();await withServer(handlers(store,{safeToFulfill:true,settled:true}),async u=>{
  const order=await (await post(u,sku)).json();assert.equal(order.state,'SETTLED_PROOF_REVIEW');assert.equal(order.fulfilled,false);
  assert.equal((await fetch(u+'/api/orders/'+order.orderId+'/download',{headers:{'X-Order-Token':order.orderToken}})).status,403);
 });
});
test('unknown SKU and cross-origin order creation rejected',async()=>{
 await withServer(handlers(fakeStore()),async u=>{
  assert.equal((await post(u,'unknown')).status,400);
  const r=await fetch(u+'/api/orders',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({sku})});assert.equal(r.status,403);
 });
});
test('database store always binds credentials and other queries through positional parameters',async()=>{
 const captured=[];const client={query:async(sql,params)=>{captured.push({sql,params});return {rows:sql.includes('RETURNING')?[{id:'order1'}]:sql.includes('SELECT *')?[{id:'order1',issued_at:'1730001000',expires_at:'1730004600',checked_at:null}]:[{ok:1}]};}};
 const store=createNeonPreviewStore(client);await store.create({id:'order1',token_hash:'a'.repeat(64),sku,amount_sats:1000,invoice:'invoice',verify_url:'verify',payment_hash:'b'.repeat(64),metadata_sha256:'c'.repeat(64),issued_at:1730001000,expires_at:1730004600},1729990000);
 const row=await store.get('order1','a'.repeat(64));assert.equal(row.expires_at,1730004600);
 assert.equal(captured[0].params.length,12);assert.equal(captured[1].params.length,2);assert.match(captured[1].sql,/token_hash=\$2/);
 assert.ok(SCHEMA.includes('CREATE TABLE IF NOT EXISTS nimlane_blink_preview_orders'));
 assert.ok(!SCHEMA.includes('DROP TABLE'));
});
