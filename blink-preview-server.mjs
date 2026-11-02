// Nimlane Blink merchant preview. Creates authentic, UNPAID mainnet Lightning invoices.
// WALLET PAYMENTS ARE ALWAYS DISABLED. Fulfillment is unlocked only in isolated
// NODE_ENV=test with deliberately named flag and mocked provider.
// Real-world preview mode ALWAYS disables fulfillment.
// This is an isolated preview server: BTCPay, its webhooks and its SQLite DB remain untouched.
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {CATALOG,findProduct} from './catalog.mjs';
import {discover,issueUnpaidInvoice,validateUsername} from './scripts/blink-lnurl.mjs';
import {verifyInvoiceBinding,checkBlinkUnpaidStatus} from './scripts/blink-invoice-guard.mjs';
import {installEntitlementLedger} from './blink-entitlement-gate.mjs';
const ROOT=resolve(import.meta.dirname);
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8792);
const USERNAME=validateUsername(process.env.BLINK_USERNAME||'alike');
const SATS=Number(process.env.BLINK_PREVIEW_SATS||1000);
if(!Number.isSafeInteger(SATS)||SATS<1||SATS>50000000)throw Error('Invalid Blink preview sat amount');
// Explicitly block all wallet execution or production claims regardless of other env flags.
if(process.env.ENABLE_WALLET_PAY==='1'||process.env.ENABLE_BLINK_FULFILLMENT==='1')throw Error('Blink preview cannot enable payments or real delivery');
const testDelivery=process.env.NODE_ENV==='test'&&process.env.ENABLE_BLINK_TEST_FULFILLMENT==='1';
const ordersEnabled=process.env.ENABLE_BLINK_PREVIEW_ORDERS==='1';
const dataDir=resolve(process.env.BLINK_PREVIEW_DATA_DIR||join(ROOT,'data'));
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(join(dataDir,'blink-preview.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS blink_preview_orders(
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, sku TEXT NOT NULL,
  amount_sats INTEGER NOT NULL CHECK(amount_sats > 0),
  invoice TEXT NOT NULL, verify_url TEXT NOT NULL, payment_hash TEXT UNIQUE NOT NULL,
  metadata_sha256 TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  last_status TEXT NOT NULL DEFAULT 'NEW', checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS blink_preview_created_idx ON blink_preview_orders(issued_at);
`);
const entitlements=installEntitlementLedger(db);
const sql={
 insert:db.prepare(`INSERT INTO blink_preview_orders
 (id,token_hash,sku,amount_sats,invoice,verify_url,payment_hash,metadata_sha256,issued_at,expires_at)
 VALUES(?,?,?,?,?,?,?,?,?,?)`),
 find:db.prepare('SELECT * FROM blink_preview_orders WHERE id=? AND token_hash=?'),
 count:db.prepare('SELECT COUNT(*) n FROM blink_preview_orders WHERE issued_at>?'),
 update:db.prepare('UPDATE blink_preview_orders SET last_status=?,checked_at=? WHERE id=?')
};
const hash=s=>createHash('sha256').update(s).digest('hex');
const now=()=>Math.floor(Date.now()/1000);
const previewCatalog=()=>CATALOG.map(({file,...p})=>({...p,amount:String(SATS),currency:'sats'}));
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(payload))}
function originAllowed(req){const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host}catch{return false}}
function body(req,limit=2048){return new Promise((ok,fail)=>{const chunks=[];let size=0;req.on('data',x=>{size+=x.length;if(size>limit){fail(Error('Body too large'));req.destroy()}else chunks.push(x)});req.on('end',()=>ok(Buffer.concat(chunks)));req.on('error',fail)})}
function auth(req,id){const t=req.headers['x-order-token'];if(typeof t!=='string'||!/^[a-f0-9]{64}$/.test(t))return null;return sql.find.get(id,hash(t))||null}
const limits=new Map();
function rate(ip){const ts=Date.now();const hit=(limits.get(ip)||[]).filter(x=>ts-x<600000);if(hit.length>=3)return false;hit.push(ts);limits.set(ip,hit);return true}
async function check(row){
 // No provider result can grant delivery in preview mode.
 let state='NEW';let proof=false;
 if(now()>row.expires_at)state='EXPIRED_UNPAID_OR_UNCERTAIN';
 try{
  const result=await checkBlinkUnpaidStatus({username:USERNAME,verifyUrl:row.verify_url,invoice:row.invoice,paymentHash:row.payment_hash});
  if(result.safeToFulfill && result.settled){proof=true;state='SETTLED_PROOF_REVIEW'}
  else if(result.reason==='NOT_SETTLED')state=now()>row.expires_at?'EXPIRED_UNPAID':'NEW';
  else state='CHECK_UNAVAILABLE';
 }catch{state='CHECK_UNAVAILABLE'}
 sql.update.run(state,now(),row.id);
 // Only a bound proof can grant an entitlement, and only in test mode.
 if(testDelivery && proof)entitlements.grantOnce(row,true,now());
 if(testDelivery && entitlements.get(row))return {state:'SETTLED_VERIFIED',proof:true};
 return {state,proof};
}
function view(row,result){const released=testDelivery&&!!entitlements.get(row);return {
 orderId:row.id,sku:row.sku,name:findProduct(row.sku)?.name||'Unknown product',
 amount:String(row.amount_sats),currency:'sats',merchantStatus:result.state,
 state:result.state,fulfilled:released,downloadAvailable:released,
 attemptStatus:null,attemptType:null,attemptCode:null,submittedHash:null,swapId:null,
 invoice:result.state==='NEW'?row.invoice:null,invoiceId:row.payment_hash,
 checkedAt:now(),paymentAllowed:false,previewOnly:true,
 settlementProofObserved:result.proof,
 message:released?'Mock-only verified proof created a test entitlement. Never use for real payments.':result.proof?'Blink returned a bound settlement proof. Preview mode never grants delivery.':'Unpaid or uncertain; no purchase access granted.'
}}
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   if(!originAllowed(req))return send(res,403,{error:'Origin denied'});
   if(path==='/api/config'&&req.method==='GET')return send(res,200,{network:'mainnet',ordersEnabled,walletEnabled:false,webhookConfigured:false,previewOnly:true,productionReady:false,testDeliveryEnabled:testDelivery,storeLabel:'Blink receive-only preview'});
   if(path==='/api/catalog'&&req.method==='GET')return send(res,200,{products:previewCatalog()});
   if(path==='/api/orders'&&req.method==='POST'){
    if(!ordersEnabled)return send(res,403,{error:'Preview order creation disabled'});
    if(!rate(req.socket.remoteAddress||'unknown')||sql.count.get(now()-86400).n>=15)return send(res,429,{error:'Preview order limit reached'});
    let input;try{input=JSON.parse((await body(req)).toString('utf8'))}catch{return send(res,400,{error:'Invalid JSON'})}
    const product=findProduct(input?.sku);if(!product)return send(res,400,{error:'Unknown product'});
    // The issuing function discovers the Blink receiver, creates an invoice, and returns
    // the EXACT trusted LNURL metadata used to request it. No independently refreshed
    // metadata is allowed to override that binding.
    const issued=await issueUnpaidInvoice(USERNAME,SATS);
    const parsed=verifyInvoiceBinding(issued.invoice,{amountMsat:SATS*1000,metadata:issued.metadata});
    const id=`NLC-${randomUUID()}`,token=randomBytes(32).toString('hex');
    sql.insert.run(id,hash(token),product.sku,SATS,issued.invoice,issued.verifyUrl,
      parsed.paymentHash,hash(issued.metadata),now(),parsed.timestampSeconds+parsed.expirySeconds);
    const row=sql.find.get(id,hash(token));
    const checked=await check(row);
    return send(res,201,{...view(row,checked),orderToken:token,recoveryCode:`${id}.${token}`});
   }
   const m=path.match(/^\/api\/orders\/(NLC-[a-f0-9-]{36})(?:\/(attempt|receipt|download))?$/);
   if(m){
    const row=auth(req,m[1]);if(!row)return send(res,404,{error:'Order unavailable or recovery code invalid'});
    const action=m[2];
    if(action==='attempt')return send(res,403,{error:'Wallet payments are disabled in Blink preview'});
    if(action==='download'){
      if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
      if(!testDelivery)return send(res,403,{error:'Preview does not deliver products even after provider settlement claims'});
      if(!entitlements.get(row))await check(row);
      if(!entitlements.get(row))return send(res,403,{error:'Invoice has no independently verified settlement entitlement'});
      const product=findProduct(row.sku);
      // Product file comes from the server-owned static catalog, never user input.
      if(!product||!/^[a-z0-9-]+\.md$/.test(product.file))return send(res,404,{error:'Product unavailable'});
      const filename=join(ROOT,'deliverables',product.file);
      if(!existsSync(filename))return send(res,404,{error:'Product unavailable'});
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8',
        'Content-Disposition':`attachment; filename="${product.file}"`,...headers});
      return res.end(readFileSync(filename));
    }
    if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
    const result=await check(row);
    if(action==='receipt')return send(res,200,{orderId:row.id,product:findProduct(row.sku)?.name,
      merchantStatus:result.state,lightningSettled:result.proof,delivered:!!(testDelivery&&entitlements.get(row)),checkedAt:now(),previewOnly:true});
    return send(res,200,view(row,result));
   }
   return send(res,404,{error:'Unknown route'});
  }
  if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
  const target=path==='/'?'/index.html':path;
  if(!(target==='/index.html'||target.startsWith('/assets/'))||target.includes('..'))return send(res,404,{error:'Not found'});
  const file=join(ROOT,'dist',target);
  if(!existsSync(file))return send(res,404,{error:'Build frontend first'});
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,...headers,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(readFileSync(file));
 }catch(e){console.error('Blink preview:',e instanceof Error?e.message:'unknown');send(res,502,{error:'Receiver unavailable. No order completed or delivered.'})}
});
if(process.env.NODE_ENV!=='test')server.listen(PORT,HOST,()=>console.log(`Nimlane Blink receiver preview http://${HOST}:${PORT} | orders:${ordersEnabled?'ON':'OFF'} wallet:OFF delivery:OFF`));
export {server,db};
