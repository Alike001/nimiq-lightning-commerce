// No-spend Blink Lightning-address preflight. NOT an implementation of payment settlement.
// A BOLT11 payment request and a LUD-21 URL do not establish a paid order.
const USER_RE=/^[a-z0-9][a-z0-9_-]{0,31}$/;
const CALLBACK_HOST='lnurl.blink.sv';
const DISCOVERY_HOST='blink.sv';
const MAX_JSON=16_384;
export function validateUsername(username){
  if(typeof username!=='string'||!USER_RE.test(username))throw Error('Invalid Blink username');
  return username;
}
export function validateBlinkUrl(input,{username,kind}){
  const user=validateUsername(username);
  if(typeof input!=='string'||input.length>2048)throw Error(`Invalid ${kind} URL`);
  let url;
  try{url=new URL(input)}catch{throw Error(`Invalid ${kind} URL`)}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)
    throw Error(`Unsafe ${kind} URL`);
  // The discovery URL is fixed. The invoice callback must match this merchant.
  // LUD-21, however, does NOT define a fixed verification URL path: Blink can
  // change this path or use an opaque token. Pin the HTTPS origin instead.
  const hosts=kind==='discovery'?[DISCOVERY_HOST]
    :kind==='callback'?[CALLBACK_HOST]
    :kind==='verify'?[CALLBACK_HOST,DISCOVERY_HOST]
    :[];
  if(!hosts.includes(url.hostname))throw Error(`Unexpected ${kind} host`);
  if(kind==='discovery'){
    if(url.pathname!==`/.well-known/lnurlp/${user}`||url.search!=='')
      throw Error('Unexpected discovery path');
  }else if(kind==='callback'){
    if(url.pathname!==`/lnurlp/blink.sv/${user}/invoice`||url.search!=='')
      throw Error('Unexpected callback path');
  }else if(kind==='verify'){
    // Exact host allowlist + no redirects protect the HTTP trust boundary.
    // The opaque path/query are provided by Blink; never execute or log them.
    if(url.pathname==='/'||url.pathname.length>1024||url.search.length>1024)
      throw Error('Unsafe verify path');
  }
  return url;
}

export function parseMetadata(meta,{username}){
  if(!meta||meta.tag!=='payRequest')throw Error('Blink did not return LNURL-pay metadata');
  const min=meta.minSendable,max=meta.maxSendable;
  if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<1||min>max)throw Error('Invalid receiver min/max');
  const callback=validateBlinkUrl(meta.callback,{username,kind:'callback'});
  if(typeof meta.metadata!=='string'||meta.metadata.length>4096)throw Error('Missing or oversized metadata');
  let metadata;
  try{metadata=JSON.parse(meta.metadata)}catch{throw Error('Invalid LNURL metadata JSON')}
  if(!Array.isArray(metadata)||!metadata.some(e=>Array.isArray(e)&&e[0]==='text/identifier'&&e[1]===`${username}@blink.sv`))
    throw Error('Lightning address identity mismatch');
  return {minMsat:min,maxMsat:max,callback:callback.toString(),metadata:meta.metadata,commentAllowed:Math.max(0,Math.min(Number(meta.commentAllowed)||0,255))};
}
export function fixedAmountMsat(sats,meta){
  if(!Number.isSafeInteger(sats)||sats<1||sats>10_000_000)throw Error('Fixed test amount must be 1-10,000,000 sats');
  const amount=sats*1000;
  if(!Number.isSafeInteger(amount)||amount<meta.minMsat||amount>meta.maxMsat)throw Error('Amount outside advertised LNURL limits');
  return amount;
}
// Only compares the amount encoded in the BOLT11 human-readable part.
// Full BOLT11 checksum, signature, description-binding and expiry validation are REQUIRED before enabling payments.
export function bolt11HrpAmountMsat(invoice){
  if(typeof invoice!=='string'||invoice.length<30||invoice.length>20_000||!invoice.startsWith('lnbc'))throw Error('Not a Bitcoin mainnet BOLT11 invoice');
  const m=/^lnbc(\d+)([munp]?)1[023456789acdefghjklmnpqrstuvwxyz]+$/.exec(invoice.toLowerCase());
  if(!m)throw Error('Malformed BOLT11 prefix or amount');
  const n=BigInt(m[1]);
  const multiplier={m:100000000n,u:100000n,n:100n,p:0n,'':100000000000n}[m[2]];
  const amount=m[2]==='p'?n/10n:n*multiplier;
  if(m[2]==='p'&&n%10n!==0n)throw Error('Fractional millisatoshi');
  if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Invoice amount too large');
  return Number(amount);
}
export function validateInvoiceResponse(obj,{username,amountMsat}){
  if(!obj||obj.status==='ERROR')throw Error('Blink invoice callback returned an error');
  const amount=bolt11HrpAmountMsat(obj.pr);
  if(amount!==amountMsat)throw Error('Blink invoice amount mismatch');
  if(typeof obj.verify!=='string')throw Error('LUD-21 verification URL not provided');
  const verify=validateBlinkUrl(obj.verify,{username,kind:'verify'});
  return {invoice:obj.pr,verifyUrl:verify.toString(),amountMsat,network:'mainnet'};
}
async function fetchJson(url,fetchFn=fetch){
  const resp=await fetchFn(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10_000),headers:{Accept:'application/json'}});
  if(!resp.ok)throw Error(`Blink returned HTTP ${resp.status}`);
  if(resp.redirected||resp.status>=300&&resp.status<400)throw Error('Blink redirect rejected');
  const clen=Number(resp.headers?.get?.('content-length'));
  if(Number.isFinite(clen)&&clen>MAX_JSON)throw Error('Oversized Blink response');
  const buf=await resp.text();
  if(buf.length>MAX_JSON)throw Error('Oversized Blink response');
  try{return JSON.parse(buf)}catch{throw Error('Blink did not return JSON')}
}
export async function discover(username,{fetchFn=fetch}={}){
  const user=validateUsername(username);
  const url=validateBlinkUrl(`https://blink.sv/.well-known/lnurlp/${user}`,{username:user,kind:'discovery'});
  const raw=await fetchJson(url,fetchFn);
  return parseMetadata(raw,{username:user});
}
export async function issueUnpaidInvoice(username,sats,{fetchFn=fetch}={}){
  const user=validateUsername(username);
  const meta=await discover(user,{fetchFn});
  const amountMsat=fixedAmountMsat(sats,meta);
  const target=validateBlinkUrl(meta.callback,{username:user,kind:'callback'});
  target.searchParams.set('amount',String(amountMsat));
  // DO NOT send a comment yet; integration must bind orders using validated invoice tags, not a plain comment.
  const res=await fetchJson(target,fetchFn);
  return {...validateInvoiceResponse(res,{username:user,amountMsat}),metadata:meta.metadata};
}
