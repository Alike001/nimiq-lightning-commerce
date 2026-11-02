import {init,getHostNetwork,NimiqProviderError} from '@nimiq/mini-app-sdk';
import './style.css';
const $=id=>document.getElementById(id);
let cfg=null, products=[], selected=null,wallet=null,working=false;
const STORAGE='nimiqLightningCommerceOrdersV03';
const byId=(id)=>document.getElementById(id);
function loadSaved(){try{const o=JSON.parse(localStorage.getItem(STORAGE));return Array.isArray(o)?o.filter(x=>typeof x?.id==='string'&&typeof x?.token==='string').slice(0,20):[]}catch{return []}}
let saved=loadSaved();
function store(){localStorage.setItem(STORAGE,JSON.stringify(saved.slice(0,20)))}
function toast(m){$('toast').textContent=m;$('toast').hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').hidden=true,6500)}
function el(tag,klass,content){const x=document.createElement(tag);if(klass)x.className=klass;if(content!==undefined)x.textContent=content;return x}
async function call(path,{method='GET',body,token}={}){
 const r=await fetch(path,{method,cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-Order-Token':token}:{})},body:body?JSON.stringify(body):undefined});
 let d;try{d=await r.json()}catch{throw Error('Unexpected server response')}
 if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;
}
function orderToken(){return selected?selected.token:null}
async function refresh(){if(!selected)return;const result=await call(`/api/orders/${encodeURIComponent(selected.id)}`,{token:orderToken()});selected.details=result;renderOrder();renderHistory();return result}
function renderCatalog(){const target=$('catalog');target.replaceChildren();for(const p of products){const box=el('article','product');const art=el('div','productArt');art.append(el('span','miniTag',p.category),el('div','preview','↯'));const body=el('div','productBody');body.append(el('h3','',p.name),el('p','',p.description));const inc=el('ul','includes');for(const line of p.includes||[])inc.append(el('li','',line));body.append(inc);const foot=el('div','buyRow');const left=el('div','price',`${p.amount} ${p.currency}`);left.append(el('small','', 'Fixed pilot price'));const btn=el('button','btn primary',cfg?.ordersEnabled?'Create order':'Orders paused');btn.disabled=!cfg?.ordersEnabled||working;btn.addEventListener('click',()=>createOrder(p.sku));foot.append(left,btn);body.append(foot);box.append(art,body);target.append(box)}}
function renderHistory(){const div=$('history');div.replaceChildren();if(!saved.length){div.append(el('p','muted','No orders on this device yet.'));return;}for(const s of saved){const line=el('div','histRow');const left=el('div');left.append(el('strong','',s.label||'Lightning order'),el('div','meta',s.id));const b=el('button','btn secondary',selected?.id===s.id?'Viewing':'View order');b.disabled=working;b.addEventListener('click',async()=>{selected=s;renderOrder();try{await refresh();toast('Merchant status refreshed.')}catch(e){toast(`Could not refresh: ${e.message}`)}});line.append(left,b);div.append(line)}}
function renderOrder(){const d=selected?.details;$('orderPanel').hidden=!selected;if(!selected)return;
 $('orderRef').textContent=selected.id;$('orderProduct').textContent=d?.name||selected.label||'Checking…';$('orderMerchant').textContent=d?.merchantStatus||'Checking…';$('attempt').textContent=d?.attemptStatus||'No attempt';$('error').textContent=d?.attemptType?`${d.attemptType}${d.attemptCode!=null?` (${d.attemptCode})`:''}`:'None';
 const ready=d?.fulfilled===true;$('statePill').textContent=ready?'PURCHASE READY':(d?.state||'VERIFYING').toUpperCase();$('statePill').style.background=ready?'#d4f5b0':'#dce7da';
 $('orderMessage').textContent=ready?'Merchant-verified Lightning settlement. Your file is available below.':d?.attemptStatus?'A wallet attempt is recorded. Do not retry this invoice. Check merchant settlement and wallet history.':'No payment has been confirmed. Delivery remains locked.';
 $('downloadBtn').hidden=!ready;
 $('payBtn').hidden=!cfg?.walletEnabled;const same=wallet?.network===cfg?.network;
 $('payBtn').disabled=working||!d?.paymentAllowed||!same;$('payBtn').textContent=!same?'Wallet/network mismatch':'Review in Nimiq Pay';
}
async function createOrder(sku){if(working)return;
 if(selected?.details && (selected.details.attemptStatus||selected.details.state==='New'||selected.details.state==='NEW'||selected.details.state==='PROCESSING'))return toast('Review the existing order before making another. No duplicate checkout.');
 working=true;renderCatalog();try{const d=await call('/api/orders',{method:'POST',body:{sku}});const id=d.orderId,token=d.orderToken;delete d.orderToken;delete d.recoveryCode;
 const s={id,token,label:d.name,details:d};saved=[s,...saved.filter(x=>x.id!==id)].slice(0,20);store();selected=s;renderHistory();renderOrder();$('orderPanel').scrollIntoView({behavior:'smooth',block:'start'});toast('Unique order and merchant invoice created. No payment made.');}
 catch(e){toast(`Order creation failed: ${e.message}`)}finally{working=false;renderCatalog()}}
$('refreshBtn').addEventListener('click',async()=>{try{await refresh();toast('Merchant status checked. A wallet hash alone cannot complete a purchase.')}catch(e){toast(`Status unavailable: ${e.message}`)}});
$('restoreBtn').addEventListener('click',async()=>{
 const code=$('recoveryInput').value.trim();const match=code.match(/^(NLC-[a-f0-9-]{36})\.([a-f0-9]{64})$/);if(!match)return toast('Use the complete private order recovery code.');
 const s={id:match[1],token:match[2]};try{const d=await call(`/api/orders/${encodeURIComponent(s.id)}`,{token:s.token});s.details=d;s.label=d.name;selected=s;saved=[s,...saved.filter(x=>x.id!==s.id)].slice(0,20);store();$('recoveryInput').value='';renderOrder();renderHistory();toast('Order recovered. Keep its code private.');}catch(e){toast(`Recovery failed: ${e.message}`)}
});
$('copyRecovery').addEventListener('click',async()=>{if(!selected)return;const v=`${selected.id}.${selected.token}`;try{await navigator.clipboard.writeText(v);toast('Recovery code copied. Anyone with it can access the purchased file.')}catch{toast('Clipboard unavailable. Use another trusted browser or device.')} });
$('downloadBtn').addEventListener('click',async()=>{if(!selected)return;try{const r=await fetch(`/api/orders/${encodeURIComponent(selected.id)}/download`,{cache:'no-store',headers:{'X-Order-Token':selected.token}});if(!r.ok){let t;try{t=(await r.json()).error}catch{}throw Error(t||`HTTP ${r.status}`)}const blob=await r.blob();const uri=URL.createObjectURL(blob);const a=document.createElement('a');a.href=uri;a.download='merchant-operations-pack-v1.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(uri),20000);toast('Merchant-verified download prepared.')}catch(e){toast(`Download unavailable: ${e.message}`)}});
$('receiptBtn').addEventListener('click',async()=>{if(!selected)return;try{const d=await call(`/api/orders/${encodeURIComponent(selected.id)}/receipt`,{token:selected.token});toast(`Merchant: ${d.merchantStatus}; Lightning settled: ${d.lightningSettled?'yes':'no'}; delivery: ${d.delivered?'ready':'locked'}.`)}catch(e){toast(`Receipt unavailable: ${e.message}`)}});
$('payBtn').addEventListener('click',async()=>{
 if(!cfg?.walletEnabled||!wallet||!selected?.details?.paymentAllowed||working||cfg.network!==wallet.network)return;
 if(!confirm('This requests a Nimiq Pay quote and could spend funds ONLY with your wallet approval. Continue?'))return;
 working=true;renderOrder();const id=selected.id,token=selected.token,invoice=selected.details.invoice;
 try{await call(`/api/orders/${encodeURIComponent(id)}/attempt`,{method:'POST',token,body:{phase:'begin'}});await refresh()}
 catch(e){working=false;renderOrder();return toast(`Wallet not called. Server rejected attempt: ${e.message}`)}
 try{const result=await wallet.provider.payLightningInvoice({invoice});await call(`/api/orders/${encodeURIComponent(id)}/attempt`,{method:'POST',token,body:{phase:'result',outcome:'SUBMITTED',hash:result.hash,swapId:result.swapId}});toast('Transaction submitted; Lightning settlement still unverified.');}
 catch(e){let type='UNKNOWN',code=null,hash=null,swapId=null;
 if(NimiqProviderError.is(e)){type=String(e.type||'UNKNOWN').replace(/[^A-Z0-9_]/g,'').slice(0,64)||'UNKNOWN';code=Number.isSafeInteger(e.code)?e.code:null;if(/^[a-fA-F0-9]{64}$/.test(e.data?.hash||''))hash=e.data.hash;if(typeof e.data?.swapId==='string')swapId=e.data.swapId.slice(0,160)}
 const outcome=type==='PERMISSION_DENIED'?'APPROVAL_REJECTED':'UNKNOWN';try{await call(`/api/orders/${encodeURIComponent(id)}/attempt`,{method:'POST',token,body:{phase:'result',outcome,errorType:type,errorCode:code,...(hash?{hash}:{}),...(swapId?{swapId}:{})}})}catch{}toast(`Wallet outcome ${type}${code==null?'':` (${code})`}. This invoice is locked; check merchant before any new payment.`)
 }finally{working=false;try{await refresh()}catch{}renderOrder()}
});
async function start(){try{const [c,p]=await Promise.all([call('/api/config'),call('/api/catalog')]);cfg=c;products=p.products;$('networkFlag').textContent=c.previewOnly?'PREVIEW · NO PAYMENTS':`RESEARCH · ${c.network.toUpperCase()}`;renderCatalog();renderHistory();if(saved.length){selected=saved[0];renderOrder();try{await refresh()}catch{toast('Saved order requires merchant status review.')}}try{const provider=await init({timeout:6500});wallet={provider,network:String(getHostNetwork()||'').toLowerCase()};$('walletStatus').textContent=`● Nimiq Pay: ${wallet.network||'unknown'}`;}catch{wallet=null;$('walletStatus').textContent='○ Open inside Nimiq Pay'}renderOrder();}catch(e){toast(`Unable to load storefront: ${e.message}`)}}start();
