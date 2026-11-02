// Read-only BOLT11 and LUD-21 proof validation for the configured Blink merchant.
// The BOLT11 signature is checked for STRUCTURAL presence only, not secp256k1 validity.
// The wallet must independently verify the BOLT11 signature before any payment.
import {createHash,timingSafeEqual} from 'node:crypto';
import {validateBlinkUrl} from './blink-lnurl.mjs';

const CHARS='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHAR_LOOKUP=new Map([...CHARS].map((c,i)=>[c,i]));
const GENERATORS=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
function polymod(data){let chk=1;for(const x of data){const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^x;for(let k=0;k<5;k++)if((top>>>k)&1)chk^=GENERATORS[k];}return chk>>>0}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
export function decodeBech32(s){
 if(typeof s!=='string'||s.length<10||s.length>20000)throw Error('Invalid BOLT11 length');
 if(s!==s.toLowerCase()&&s!==s.toUpperCase())throw Error('Mixed-case BOLT11');
 const val=s.toLowerCase(); const sep=val.lastIndexOf('1');
 if(sep<2||sep+7>val.length)throw Error('Malformed BOLT11 separator');
 const hrp=val.slice(0,sep);let raw=[];
 for(const c of val.slice(sep+1)){const n=CHAR_LOOKUP.get(c);if(n===undefined)throw Error('Invalid BOLT11 character');raw.push(n)}
 if(polymod(hrpExpand(hrp).concat(raw))!==1)throw Error('Invalid BOLT11 checksum');
 return {hrp,data:raw.slice(0,-6)};
}
function bitsToBytes(words){let value=0,bits=0,out=[];for(const word of words){if(word<0||word>31)throw Error('Invalid BOLT11 word');value=(value<<5)|word;bits+=5;while(bits>=8){bits-=8;out.push((value>>>bits)&255)}}if(bits>=5||((value<<(8-bits))&255)!==0)throw Error('Non-canonical BOLT11 padding');return Buffer.from(out)}
function asTagInt(words){let n=0;for(const word of words){n=n*32+word;if(!Number.isSafeInteger(n))throw Error('Oversized BOLT11 tag integer')}return n}
function readAmountMsat(hrp){const m=/^ln(bc|tb|bcrt|sb)([1-9][0-9]*)([munp]?)$/.exec(hrp);if(!m)throw Error('BOLT11 must specify a positive exact amount');const network=({bc:'mainnet',tb:'testnet',bcrt:'regtest',sb:'signet'})[m[1]];let n=BigInt(m[2]);const multiplier=({m:100000000n,u:100000n,n:100n,p:1n,'':100000000000n})[m[3]];n=n*multiplier;if(m[3]==='p'){if(n%10n)throw Error('Sub-millisatoshi invoice amount');n/=10n;}if(n<=0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Unsupported BOLT11 amount');return {network,amountMsat:Number(n)}}
const TAG={p:1,d:13,h:23,x:6,s:16};
export function parseBolt11(invoice,{nowSeconds=Math.floor(Date.now()/1000)}={}){
 const {hrp,data}=decodeBech32(invoice);const amount=readAmountMsat(hrp);
 if(data.length<7+104)throw Error('BOLT11 signature or timestamp missing');
 const stamp=asTagInt(data.slice(0,7));if(!stamp)throw Error('Missing BOLT11 timestamp');
 const end=data.length-104;let pos=7,hash=null,secret=null,descriptionHash=null,description=null,expiry=3600;const seen=new Set();
 while(pos<end){if(pos+3>end)throw Error('Truncated BOLT11 tag');const type=data[pos];const len=data[pos+1]*32+data[pos+2];pos+=3;if(pos+len>end)throw Error('Truncated BOLT11 tag value');const payload=data.slice(pos,pos+len);pos+=len;
  if(Object.values(TAG).includes(type)){if(seen.has(type))throw Error('Duplicate BOLT11 tag');seen.add(type)}
  if(type===TAG.p||type===TAG.h||type===TAG.s){const bytes=bitsToBytes(payload);if(bytes.length!==32)throw Error('Invalid 32-byte BOLT11 tag');const hex=bytes.toString('hex');if(type===TAG.p)hash=hex;else if(type===TAG.h)descriptionHash=hex;else secret=hex}
  else if(type===TAG.d)description=bitsToBytes(payload).toString('utf8');
  else if(type===TAG.x){if(!payload.length)throw Error('Invalid empty BOLT11 expiry');expiry=asTagInt(payload)}
 }
 const signature=bitsToBytes(data.slice(end));if(signature.length!==65||signature[64]>3)throw Error('Malformed BOLT11 signature structure');
 if(!hash||!secret)throw Error('Missing payment hash or payment secret');
 if((description===null)===(descriptionHash===null))throw Error('Exactly one BOLT11 description form required');
 if(stamp>nowSeconds+300)throw Error('BOLT11 timestamp too far in future');
 if(expiry<1||stamp+expiry<=nowSeconds+60)throw Error('BOLT11 expired or nearly expired');
 return {...amount,paymentHash:hash,paymentSecret:secret,description,descriptionHash,timestampSeconds:stamp,expirySeconds:expiry,signatureStructurallyPresent:true,signatureCryptographicallyVerified:false};
}
export function verifyInvoiceBinding(invoice,{amountMsat,metadata,nowSeconds}={}){
 const info=parseBolt11(invoice,{nowSeconds});if(info.network!=='mainnet')throw Error('Wrong Lightning network');
 if(info.amountMsat!==amountMsat)throw Error('Wrong Lightning amount');
 if(typeof metadata!=='string'||!metadata)throw Error('Missing trusted receiver metadata');
 const expected=createHash('sha256').update(metadata,'utf8').digest('hex');
 if(!info.descriptionHash||!timingSafeEqual(Buffer.from(info.descriptionHash,'hex'),Buffer.from(expected,'hex')))throw Error('Invoice is not bound to Blink receiver metadata');
 return info;
}
export function verifySettlementResponse(raw,{invoice,paymentHash}){
 if(!raw||typeof raw!=='object'||raw.status==='ERROR')return {settled:false,safeToFulfill:false,reason:'UNKNOWN_OR_ERROR'};
 if(raw.settled!==true)return {settled:false,safeToFulfill:false,reason:'NOT_SETTLED'};
 if(typeof raw.pr!=='string'||raw.pr.toLowerCase()!==invoice.toLowerCase())throw Error('Settlement invoice does not match order');
 if(typeof raw.preimage!=='string'||!/^[a-fA-F0-9]{64}$/.test(raw.preimage))throw Error('Settlement preimage missing or invalid');
 const digest=createHash('sha256').update(Buffer.from(raw.preimage,'hex')).digest('hex');
 if(!/^[a-f0-9]{64}$/.test(paymentHash)||!timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(paymentHash,'hex')))throw Error('Settlement preimage is not bound to the invoice');
 return {settled:true,safeToFulfill:true,reason:'PREIMAGE_VERIFIED'};
}
export async function checkBlinkUnpaidStatus({username,verifyUrl,invoice,paymentHash,fetchFn=fetch}){
 const target=validateBlinkUrl(verifyUrl,{username,kind:'verify'});
 const r=await fetchFn(target.toString(),{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10_000)});
 if(!r.ok)throw Error(`Blink verify HTTP ${r.status}`);
 const length=Number(r.headers?.get?.('content-length'));if(Number.isFinite(length)&&length>16384)throw Error('Oversized Blink verification response');
 const text=await r.text();if(text.length>16384)throw Error('Oversized Blink verification response');
 let obj;try{obj=JSON.parse(text)}catch{throw Error('Invalid Blink verification JSON')}
 return verifySettlementResponse(obj,{invoice,paymentHash});
}
