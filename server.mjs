import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {openDb,tokenHash,recordFulfillment} from './db.mjs';
import {CATALOG,findProduct,safeCatalog} from './catalog.mjs';
import {lightningInvoice,settlementGate} from './rules.mjs';
import {verifyBtcpaySignature,validateBtcpayEvent,validateAttemptReport,validTxHash} from './guards.mjs';
const BASE=resolve(import.meta.dirname);
const PORT=Number(process.env.PORT||8790);
const HOST=process.env.HOST||'127.0.0.1';
const ordersEnabled=process.env.ENABLE_ORDER_CREATION==='1';
const walletEnabled=process.env.ENABLE_WALLET_PAY==='1';
const network=process.env.BITCOIN_NETWORK||'testnet';
const bUrl=(process.env.BTCPAY_URL||'').replace(/\/+$/,'');
const store=process.env.BTCPAY_STORE_ID||'';
const apiKey=process.env.BTCPAY_API_KEY||'';
const secret=process.env.BTCPAY_WEBHOOK_SECRET||'';
if(!/^https:\/\//.test(bUrl)||!apiKey||!store)throw Error('Private BTCPay API credentials required');
if(!['testnet','mainnet'].includes(network))throw Error('Unknown Bitcoin network');
if(network==='mainnet' && (process.env.CONFIRM_PRODUCTION_RECEIVER!=='YES'||process.env.PRODUCTION_SECURITY_REVIEW!=='YES'))throw Error('Mainnet requires receiver and security review');
if(walletEnabled && process.env.CONFIRM_WALLET_PAY_GATE!=='YES')throw Error('Payment gate not explicitly confirmed');
if(walletEnabled && network==='mainnet' && process.env.CONFIRM_REAL_FUNDS!=='YES')throw Error('Mainnet funds gate closed');
const db=openDb(process.env.DATA_DIR?resolve(process.env.DATA_DIR):BASE);
const sql={
 create:db.prepare('INSERT INTO orders (id,token_hash,sku,invoice_id,created_at) VALUES (?,?,?,?,?)'),
 get:db.prepare('SELECT * FROM orders WHERE id=? AND token_hash=?'),
 byInvoice:db.prepare('SELECT * FROM orders WHERE invoice_id=?'),
 count:db.prepare('SELECT COUNT(*) n FROM orders WHERE created_at>?'),
 update:db.prepare('UPDATE orders SET last_merchant_status=?,checked_at=? WHERE id=?'),
 start:db.prepare("UPDATE orders SET attempt_status='AWAITING_WALLET' WHERE id=? AND token_hash=? AND attempt_status IS NULL"),
 finish:db.prepare("UPDATE orders SET attempt_status=?,attempt_type=?,attempt_code=?,swap_id=?,tx_hash=? WHERE id=? AND token_hash=? AND attempt_status='AWAITING_WALLET'"),
 getEvent:db.prepare('SELECT delivery_id FROM webhook_events WHERE delivery_id=?'),
 saveEvent:db.prepare('INSERT OR IGNORE INTO webhook_events(delivery_id,invoice_id,type,verified_at) VALUES(?,?,?,?)'),
 download:db.prepare('UPDATE orders SET delivery_count=delivery_count+1 WHERE id=? AND fulfilled_at IS NOT NULL'),
};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY'};
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(obj))}
function originAllowed(req){const o=req.headers.origin;if(!o)return true;try{return new URL(o).host===req.headers.host}catch{return false}}
function body(req,max=16000){return new Promise((ok,fail)=>{const parts=[];let n=0;req.on('data',x=>{n+=x.length;if(n>max){fail(Error('Request too large'));req.destroy()}else parts.push(x)});req.on('end',()=>ok(Buffer.concat(parts)));req.on('error',fail)})}
async function merchant(path,method='GET',obj){const r=await fetch(`${bUrl}${path}`,{method,headers:{Authorization:`token ${apiKey}`,Accept:'application/json',...(obj?{'Content-Type':'application/json'}:{})},body:obj?JSON.stringify(obj):undefined,signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error(`BTCPay status ${r.status}`);return r.json()}
function authorization(req,id){const token=req.headers['x-order-token'];if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;return sql.get.get(id,tokenHash(token))||null}
const now=()=>Math.floor(Date.now()/1000);
async function verify(row){
 const product=findProduct(row.sku);if(!product)throw Error('Unknown product in order');
 const encoded=encodeURIComponent(row.invoice_id);
 const [invoice,methods]=await Promise.all([merchant(`/api/v1/invoices/${encoded}?includePaymentMethods=true`),merchant(`/api/v1/invoices/${encoded}/payment-methods`)]);
 const gate=settlementGate(invoice,methods,row,product);
 sql.update.run(invoice.status,now(),row.id);
 if(gate.ok) recordFulfillment(db,row.id,now());
 const latest=sql.byInvoice.get(row.invoice_id);
 return {row:latest, product, invoice, methods, gate};
}
function view({row,product,invoice,methods,gate}){
 const bolt=invoice.status==='New' && row.attempt_status===null ? lightningInvoice(methods,network):null;
 const attempted=!!row.attempt_status;
 return {orderId:row.id,sku:product.sku,name:product.name,amount:product.amount,currency:product.currency,
  merchantStatus:invoice.status, additionalStatus:invoice.additionalStatus||'None',
  state:row.fulfilled_at?'READY':gate.ok?'VERIFYING':gate.state,
  fulfilled:!!row.fulfilled_at, attemptStatus:row.attempt_status,
  attemptType:row.attempt_type,attemptCode:row.attempt_code,
  submittedHash:validTxHash(row.tx_hash)?row.tx_hash:null,swapId:row.swap_id,
  invoice:bolt,invoiceId:row.invoice_id,downloadAvailable:!!row.fulfilled_at,
  checkedAt:row.checked_at, paymentAllowed:walletEnabled&&!attempted&&!!bolt};
}
const windows=new Map();
function rate(ip){const ts=Date.now(),prev=(windows.get(ip)||[]).filter(x=>ts-x<600000);if(prev.length>=3)return false;prev.push(ts);windows.set(ip,prev);return true}
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 if(path==='/api/webhooks/btcpay'&&req.method==='POST'){
  if(!secret)return send(res,503,{error:'Webhook disabled'});
  const raw=await body(req);
  if(!verifyBtcpaySignature(raw,req.headers['btcpay-sig'],secret))return send(res,401,{error:'Invalid webhook signature'});
  let e;try{e=JSON.parse(raw.toString('utf8'))}catch{return send(res,400,{error:'Invalid webhook JSON'})}
  if(!validateBtcpayEvent(e,store))return send(res,400,{error:'Webhook rejected'});
  if(sql.getEvent.get(e.deliveryId))return send(res,200,{ok:true,duplicate:true});
  const row=sql.byInvoice.get(e.invoiceId);
  if(!row)return send(res,200,{ok:true,unmatched:true});
  const state=await verify(row); // Webhook never overrides trusted BTCPay GET.
  sql.saveEvent.run(e.deliveryId,e.invoiceId,e.type,now());
  return send(res,200,{ok:true,rechecked:true,fulfilled:!!state.row.fulfilled_at});
 }
 if(path.startsWith('/api/')){
  if(!originAllowed(req))return send(res,403,{error:'Origin denied'});
  if(req.method==='GET'&&path==='/api/config')return send(res,200,{network,ordersEnabled,walletEnabled,webhookConfigured:!!secret,storeLabel:'Nimiq Lightning Pilot',productionReady:false});
  if(req.method==='GET'&&path==='/api/catalog')return send(res,200,{products:safeCatalog()});
  if(req.method==='POST'&&path==='/api/orders'){
   if(!ordersEnabled)return send(res,403,{error:'Creating orders is disabled'});
   if(!rate(req.socket.remoteAddress||'unknown')||sql.count.get(now()-86400).n>=15)return send(res,429,{error:'Research order limit reached'});
   let input;try{input=JSON.parse((await body(req,2048)).toString('utf8'))}catch{return send(res,400,{error:'Invalid input'})}
   const product=findProduct(input.sku);if(!product)return send(res,400,{error:'Product not found'});
   const id=`NLC-${randomUUID()}`,token=randomBytes(32).toString('hex');
   const inv=await merchant(`/api/v1/stores/${encodeURIComponent(store)}/invoices`,'POST',{amount:product.amount,currency:product.currency,metadata:{orderId:id,itemDesc:product.name}});
   if(typeof inv.id!=='string'||!/^[a-zA-Z0-9_-]{5,150}$/.test(inv.id))throw Error('Invalid invoice ID');
   sql.create.run(id,tokenHash(token),product.sku,inv.id,now());
   const checked=await verify(sql.get.get(id,tokenHash(token)));
   return send(res,201,{...view(checked),recoveryCode:`${id}.${token}`,orderToken:token});
  }
  const m=path.match(/^\/api\/orders\/(NLC-[a-f0-9-]{36})(?:\/(attempt|download|receipt))?$/);
  if(m){
   const row=authorization(req,m[1]);if(!row)return send(res,404,{error:'Order unavailable or recovery code invalid'});
   const action=m[2];
   if(!action&&req.method==='GET')return send(res,200,view(await verify(row)));
   if(action==='attempt'&&req.method==='POST'){
    if(!walletEnabled)return send(res,403,{error:'Wallet payment disabled'});
    let x;try{x=JSON.parse((await body(req,2048)).toString('utf8'))}catch{return send(res,400,{error:'Invalid input'})}
    if(x.phase==='begin'){
      if(row.attempt_status)return send(res,409,{error:'Attempt already recorded — never retry invoice'});
      const state=await verify(row);
      if(state.invoice.status!=='New'||!lightningInvoice(state.methods,network))return send(res,409,{error:'Invoice not fresh or network not supported'});
      if(sql.start.run(row.id,row.token_hash).changes!==1)return send(res,409,{error:'Attempt already recorded'});
      return send(res,200,{attemptStatus:'AWAITING_WALLET'});
    }
    if(!validateAttemptReport(x))return send(res,400,{error:'Invalid attempt report'});
    if(sql.finish.run(x.outcome,x.errorType||null,x.errorCode??null,x.swapId||null,x.hash||null,row.id,row.token_hash).changes!==1)return send(res,409,{error:'Attempt locked'});
    return send(res,200,{attemptStatus:x.outcome});
   }
   if(action==='receipt'&&req.method==='GET'){
    const s=await verify(row);return send(res,200,{orderId:row.id,product:s.product.name,invoiceId:row.invoice_id,merchantStatus:s.invoice.status,lightningSettled:s.gate.ok,delivered:!!s.row.fulfilled_at,checkedAt:now()});
   }
   if(action==='download'&&req.method==='GET'){
    const s=await verify(row);
    if(!s.gate.ok||!s.row.fulfilled_at)return send(res,403,{error:'Verified Lightning settlement required for delivery'});
    const file=join(BASE,'deliverables',s.product.file);
    if(!existsSync(file))return send(res,503,{error:'Merchant deliverable unavailable'});
    sql.download.run(row.id);
    res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${s.product.file}"`,...headers});return res.end(readFileSync(file));
   }
  }
  return send(res,404,{error:'Unknown route'});
 }
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
 const target=path==='/'?'/index.html':path;
 if(!(target==='/index.html'||target.startsWith('/assets/'))||target.includes('..'))return send(res,404,{error:'Not found'});
 const file=join(BASE,'dist',target);
 if(!existsSync(file))return send(res,404,{error:'Build frontend first'});
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':mime,...headers,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(readFileSync(file));
 }catch(e){console.error('Request:',e instanceof Error?e.message:'unknown');return send(res,502,{error:'Merchant status unavailable. No automatic retry or delivery.'})}
});
if(process.env.NODE_ENV!=='test')server.listen(PORT,HOST,()=>console.log(`Nimiq Lightning pilot http://${HOST}:${PORT} | order:${ordersEnabled?'ON':'OFF'} wallet:${walletEnabled?'ON':'OFF'} network:${network} webhook:${secret?'ON':'OFF'}`));
export {server,db};
