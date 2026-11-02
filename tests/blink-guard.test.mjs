import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {decodeBech32,parseBolt11,verifyInvoiceBinding,verifySettlementResponse,checkBlinkUnpaidStatus} from '../scripts/blink-invoice-guard.mjs';
const ABC='qpzry9x8gf2tvdw0s3jn54khce6mua7l';const GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
function poly(arr){let chk=1;for(let v of arr){let top=chk>>>25;chk=((chk&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((top>>>i)&1)chk^=GEN[i]}return chk>>>0}
function words(bytes){let out=[],v=0,bits=0;for(let b of bytes){v=(v<<8)|b;bits+=8;while(bits>=5){bits-=5;out.push((v>>>bits)&31)}}if(bits)out.push((v<<(5-bits))&31);return out}
function encode(hrp,data){const pre=[...hrp].map(x=>x.charCodeAt(0)>>>5).concat([0],[...hrp].map(x=>x.charCodeAt(0)&31));let mod=poly(pre.concat(data,[0,0,0,0,0,0]))^1;let check=Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31);return hrp+'1'+data.concat(check).map(v=>ABC[v]).join('')}
function tag(c,bytes){let a=words(bytes),t=ABC.indexOf(c);return [t,a.length>>>5,a.length&31,...a]}
const metadata='[["text/plain","Pay to alike@blink.sv"],["text/identifier","alike@blink.sv"]]';
const PREIMAGE=Buffer.alloc(32,7);const HASH=createHash('sha256').update(PREIMAGE).digest('hex');
const stamp=Math.floor(Date.now()/1000);
function sample({network='lnbc',msats=1000000,desc=metadata,seconds=stamp,expiry=3600,includeH=true,hash=HASH}={}){
 const hrp=network+(msats/100)+'n';let ts=[],x=seconds;for(let i=0;i<7;i++){ts.unshift(x%32);x=Math.floor(x/32)}
 let data=ts.concat(tag('p',Buffer.from(hash,'hex')),tag('s',Buffer.alloc(32,8)));
 if(includeH)data.push(...tag('h',createHash('sha256').update(desc).digest()));else data.push(...tag('d',Buffer.from('other merchant')));
 data.push(...[ABC.indexOf('x'),0,3,expiry>>>10,(expiry>>>5)&31,expiry&31]);
 let sig=Buffer.alloc(65,9);sig[64]=1;data.push(...words(sig));return encode(hrp,data);
}
const invoice=sample();
test('valid structural BOLT11 invoice and full metadata binding',()=>{const x=verifyInvoiceBinding(invoice,{amountMsat:1000000,metadata});assert.equal(x.paymentHash,HASH);assert.equal(x.network,'mainnet');assert.equal(x.signatureCryptographicallyVerified,false)});
test('BOLT11 checksum is required',()=>assert.throws(()=>decodeBech32(invoice.slice(0,-1)+(invoice.endsWith('q')?'p':'q')),/checksum/));
test('reject mixed-case bech32',()=>assert.throws(()=>parseBolt11('LNBC'+invoice.slice(4)),/Mixed-case/));
test('reject wrong currency/network',()=>assert.throws(()=>verifyInvoiceBinding(sample({network:'lntb'}),{amountMsat:1000000,metadata}),/network/));
test('reject wrong amount',()=>assert.throws(()=>verifyInvoiceBinding(invoice,{amountMsat:2000000,metadata}),/amount/));
test('reject merchant metadata substitution',()=>assert.throws(()=>verifyInvoiceBinding(invoice,{amountMsat:1000000,metadata:'attacker'}),/metadata/));
test('reject plain description rather than metadata hash',()=>assert.throws(()=>verifyInvoiceBinding(sample({includeH:false}),{amountMsat:1000000,metadata}),/metadata/));
test('reject expired invoice',()=>assert.throws(()=>parseBolt11(sample({seconds:stamp-3700})),/expired/));
test('reject near-expired invoice',()=>assert.throws(()=>parseBolt11(sample({seconds:stamp-3550})),/expired/));
test('reject future invoice',()=>assert.throws(()=>parseBolt11(sample({seconds:stamp+1200})),/future/));
test('unpaid LUD21 does not grant delivery',()=>{assert.deepEqual(verifySettlementResponse({settled:false},{invoice,paymentHash:HASH}),{settled:false,safeToFulfill:false,reason:'NOT_SETTLED'})});
test('transient LUD21 ERROR does not grant delivery',()=>assert.equal(verifySettlementResponse({status:'ERROR',reason:'Internal server error'},{invoice,paymentHash:HASH}).safeToFulfill,false));
test('forged settlement missing invoice is rejected',()=>assert.throws(()=>verifySettlementResponse({settled:true,preimage:PREIMAGE.toString('hex')},{invoice,paymentHash:HASH}),/invoice/));
test('forged settlement for different invoice is rejected',()=>assert.throws(()=>verifySettlementResponse({settled:true,pr:'different',preimage:PREIMAGE.toString('hex')},{invoice,paymentHash:HASH}),/invoice/));
test('forged preimage is rejected',()=>assert.throws(()=>verifySettlementResponse({settled:true,pr:invoice,preimage:Buffer.alloc(32,2).toString('hex')},{invoice,paymentHash:HASH}),/preimage/));
test('valid preimage bound to exact invoice passes proof gate',()=>assert.equal(verifySettlementResponse({settled:true,pr:invoice,preimage:PREIMAGE.toString('hex')},{invoice,paymentHash:HASH}).safeToFulfill,true));
test('rejects external verification endpoint before fetch',async()=>{let used=false;await assert.rejects(()=>checkBlinkUnpaidStatus({username:'alike',verifyUrl:'https://evil.com/token',invoice,paymentHash:HASH,fetchFn:()=>{used=true;}}),/host/);assert.equal(used,false)});
test('read-only verify endpoint returning unsettled is denied',async()=>{const fetchFn=async()=>new Response(JSON.stringify({settled:false}),{status:200,headers:{'Content-Type':'application/json'}});const result=await checkBlinkUnpaidStatus({username:'alike',verifyUrl:'https://lnurl.blink.sv/verify/random',invoice,paymentHash:HASH,fetchFn});assert.equal(result.safeToFulfill,false)});
test('rejects HTTP redirect from verify endpoint',async()=>{const fetchFn=async()=>new Response('',{status:302,headers:{Location:'https://evil.com'}});await assert.rejects(()=>checkBlinkUnpaidStatus({username:'alike',verifyUrl:'https://lnurl.blink.sv/verify/x',invoice,paymentHash:HASH,fetchFn}),/HTTP/)});
