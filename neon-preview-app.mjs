// Nimlane Postgres-backed, receive-only storefront. Wallet and delivery are
// disabled by design, regardless of environment variables.
import {readFileSync,existsSync} from 'node:fs';
import {join,extname} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {CATALOG,findProduct} from './catalog.mjs';
import {verifyInvoiceBinding,checkBlinkUnpaidStatus} from './scripts/blink-invoice-guard.mjs';
import {issueUnpaidInvoice} from './scripts/blink-lnurl.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const common={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const asInt=(v,min,max)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid preview amount');return n};
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...common});res.end(JSON.stringify(payload));}
function readBody(req,max=2048){return new Promise((ok,fail)=>{const chunks=[];let size=0;req.on('data',b=>{size+=b.length;if(size>max){fail(Error('Request too large'));req.destroy();return}chunks.push(b)});req.on('end',()=>ok(Buffer.concat(chunks)));req.on('error',fail)});}
function sameOrigin(req){if(!req.headers.origin)return true;try{return new URL(req.headers.origin).host===req.headers.host}catch{return false}}

export function createNeonPreviewHandler({store,root,username='alike',sats=1000,ordersEnabled=false,
  issue=issueUnpaidInvoice,inspect=verifyInvoiceBinding,statusCheck=checkBlinkUnpaidStatus,clock=()=>Math.floor(Date.now()/1000)}) {
  const amount=asInt(sats,1,50000000), hits=new Map();
  const catalog=()=>CATALOG.map(({file,...p})=>({...p,amount:String(amount),currency:'sats'}));
  async function review(order){
    let state=clock()>order.expires_at?'EXPIRED_UNPAID_OR_UNCERTAIN':'NEW',proof=false;
    try {
      const check=await statusCheck({username,verifyUrl:order.verify_url,invoice:order.invoice,paymentHash:order.payment_hash});
      if(check?.safeToFulfill&&check?.settled){state='SETTLED_PROOF_REVIEW';proof=true;}
      else if(check?.reason==='NOT_SETTLED')state=clock()>order.expires_at?'EXPIRED_UNPAID':'NEW';
      else state='CHECK_UNAVAILABLE';
    } catch {state='CHECK_UNAVAILABLE'}
    await store.updateStatus(order.id,state,clock());
    return {state,proof};
  }
  function view(order,checked){return {
    orderId:order.id,sku:order.sku,name:findProduct(order.sku)?.name||'Unknown product',
    amount:String(order.amount_sats),currency:'sats',merchantStatus:checked.state,state:checked.state,
    fulfilled:false,downloadAvailable:false,attemptStatus:null,attemptType:null,attemptCode:null,
    submittedHash:null,swapId:null,invoice:checked.state==='NEW'?order.invoice:null,
    invoiceId:order.payment_hash,checkedAt:clock(),paymentAllowed:false,previewOnly:true,
    settlementProofObserved:checked.proof,
    message:checked.proof?'Settlement proof observed; no preview fulfillment allowed.':'Unpaid or uncertain; no access granted.'
  }}
  return async function handler(req,res){
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(path.startsWith('/api/')){
        if(!sameOrigin(req))return json(res,403,{error:'Origin denied'});
        if(path==='/api/health'&&req.method==='GET'){const healthy=await store.checkReady();return json(res,healthy?200:503,{ok:healthy,previewOnly:true});}
        if(path==='/api/config'&&req.method==='GET')return json(res,200,{
          network:'mainnet',ordersEnabled,walletEnabled:false,webhookConfigured:false,
          previewOnly:true,productionReady:false,testDeliveryEnabled:false,storeLabel:'Blink Neon receive-only preview'});
        if(path==='/api/catalog'&&req.method==='GET')return json(res,200,{products:catalog()});
        if(path==='/api/orders'&&req.method==='POST'){
          if(!ordersEnabled)return json(res,403,{error:'Preview order creation disabled'});
          const ip=req.socket.remoteAddress||'unknown',t=Date.now(),list=(hits.get(ip)||[]).filter(x=>t-x<600000);
          if(list.length>=3)return json(res,429,{error:'Preview order rate limit reached'});
          list.push(t);hits.set(ip,list);
          let input;try{input=JSON.parse((await readBody(req)).toString('utf8'));}catch{return json(res,400,{error:'Invalid JSON'})}
          const product=findProduct(input?.sku);if(!product)return json(res,400,{error:'Unknown product'});
          // No funds sent. Provider can generate an invoice, nothing else.
          const issued=await issue(username,amount);
          const parsed=inspect(issued.invoice,{amountMsat:amount*1000,metadata:issued.metadata});
          const id=`NLC-${randomUUID()}`,token=randomBytes(32).toString('hex');
          const row={id,token_hash:hash(token),sku:product.sku,amount_sats:amount,invoice:issued.invoice,
            verify_url:issued.verifyUrl,payment_hash:parsed.paymentHash,metadata_sha256:hash(issued.metadata),
            issued_at:clock(),expires_at:parsed.timestampSeconds+parsed.expirySeconds};
          if(!(await store.create(row,clock()-86400,15)))return json(res,429,{error:'Preview order capacity reached'});
          const checked=await review(row);
          return json(res,201,{...view(row,checked),orderToken:token,recoveryCode:`${id}.${token}`});
        }
        const m=path.match(/^\/api\/orders\/(NLC-[a-f0-9-]{36})(?:\/(attempt|receipt|download))?$/);
        if(m){
          const token=req.headers['x-order-token'];
          if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return json(res,404,{error:'Order unavailable'});
          const row=await store.get(m[1],hash(token));if(!row)return json(res,404,{error:'Order unavailable'});
          if(m[2]==='attempt')return json(res,403,{error:'Wallet execution disabled'});
          if(m[2]==='download')return json(res,403,{error:'Preview never delivers purchased files'});
          if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
          const checked=await review(row);
          if(m[2]==='receipt')return json(res,200,{orderId:row.id,product:findProduct(row.sku)?.name,
            merchantStatus:checked.state,lightningSettled:checked.proof,delivered:false,checkedAt:clock(),previewOnly:true});
          return json(res,200,view(row,checked));
        }
        return json(res,404,{error:'Unknown route'});
      }
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      const target=path==='/'?'/index.html':path;
      if(!(target==='/index.html'||target.startsWith('/assets/'))||target.includes('..'))return json(res,404,{error:'Not found'});
      const file=join(root,'dist',target);
      if(!existsSync(file))return json(res,404,{error:'Build frontend first'});
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,...common,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return res.end(readFileSync(file));
    } catch(e){console.error('Neon preview error:',e instanceof Error?e.message:'unknown');
      if(!res.headersSent)return json(res,502,{error:'Preview temporarily unavailable; no payment submitted.'});res.end();}
  };
}
