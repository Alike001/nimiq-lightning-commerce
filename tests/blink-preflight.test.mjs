import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBlinkUrl,parseMetadata,fixedAmountMsat,bolt11HrpAmountMsat,validateInvoiceResponse,issueUnpaidInvoice} from '../scripts/blink-lnurl.mjs';
const username='alike';
const callback='https://lnurl.blink.sv/lnurlp/blink.sv/alike/invoice';
const verify='https://lnurl.blink.sv/lnurlp/blink.sv/alike/verify/abc';
const meta={callback,minSendable:1000,maxSendable:50_000_000_000,tag:'payRequest',metadata:JSON.stringify([['text/plain','Pay to alike@blink.sv'],['text/identifier','alike@blink.sv']]),commentAllowed:255};
test('metadata is bound to configured address',()=>assert.equal(parseMetadata(meta,{username}).minMsat,1000));
test('reject metadata with different merchant identifier',()=>assert.throws(()=>parseMetadata({...meta,metadata:'[["text/identifier","attacker@blink.sv"]]'},{username}),/mismatch/));
test('reject a callback outside allowlisted Blink host',()=>assert.throws(()=>validateBlinkUrl('https://attacker.example/invoice',{username,kind:'callback'}),/host/));
test('reject an IP/SSRF callback',()=>assert.throws(()=>validateBlinkUrl('https://127.0.0.1/lnurlp/blink.sv/alike/invoice',{username,kind:'callback'}),/host/));
test('reject callback for different username',()=>assert.throws(()=>validateBlinkUrl('https://lnurl.blink.sv/lnurlp/blink.sv/other/invoice',{username,kind:'callback'}),/path/));
test('reject insecure callback',()=>assert.throws(()=>validateBlinkUrl('http://lnurl.blink.sv/lnurlp/blink.sv/alike/invoice',{username,kind:'callback'}),/Unsafe/));
test('amount in sats converts to msats',()=>assert.equal(fixedAmountMsat(1000,{minMsat:1000,maxMsat:50_000_000_000}),1_000_000));
test('reject amount outside limits',()=>assert.throws(()=>fixedAmountMsat(2,{minMsat:3000,maxMsat:50_000}),/limits/));
test('decode mainnet BOLT11 HRP unit n',()=>assert.equal(bolt11HrpAmountMsat('lnbc10000n1'+'q'.repeat(30)),1_000_000));
test('decode mainnet BOLT11 HRP unit u',()=>assert.equal(bolt11HrpAmountMsat('lnbc10u1'+'q'.repeat(30)),1_000_000));
test('reject BTC testnet invoice',()=>assert.throws(()=>bolt11HrpAmountMsat('lntb10000n1'+'q'.repeat(30)),/mainnet/));
test('reject callback invoice with wrong amount',()=>assert.throws(()=>validateInvoiceResponse({pr:'lnbc1000n1'+'q'.repeat(30),verify},{username,amountMsat:1_000_000}),/amount mismatch/));
test('reject missing LUD-21 URL',()=>assert.throws(()=>validateInvoiceResponse({pr:'lnbc10000n1'+'q'.repeat(30)},{username,amountMsat:1_000_000}),/not provided/));
test('reject attacker verification URL',()=>assert.throws(()=>validateInvoiceResponse({pr:'lnbc10000n1'+'q'.repeat(30),verify:'https://evil.example/lnurlp/blink.sv/alike/verify'},{username,amountMsat:1_000_000}),/host/));
test('mocked unpaid invoice can be issued with a verify URL',async()=>{
  let requests=0;
  const fetchFn=async url=>{
    requests++;
    const obj=requests===1?meta:{pr:'lnbc10000n1'+'q'.repeat(30),verify};
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(obj)};
  };
  const r=await issueUnpaidInvoice('alike',1000,{fetchFn});
  assert.equal(r.amountMsat,1_000_000);
  assert.equal(r.verifyUrl,verify);
  assert.equal(requests,2);
});

// Real provider integration does not promise a fixed LUD-21 verify path.
// These tests preserve HTTPS, host, userinfo, fragment, and port protection.
test('accept opaque provider verification URL on trusted Blink host',()=>{
  const v='https://lnurl.blink.sv/payments/status/v2/opaque-token?key=a1b2';
  assert.equal(validateBlinkUrl(v,{username,kind:'verify'}).toString(),v);
});
test('accept a verify route hosted directly at blink.sv',()=>{
  const v='https://blink.sv/verify/opaque-hash';
  assert.equal(validateBlinkUrl(v,{username,kind:'verify'}).toString(),v);
});
test('reject a verification request to an external host',()=>assert.throws(()=>validateBlinkUrl('https://attacker.example/status/secret',{username,kind:'verify'}),/host/));
test('reject HTTPS URL containing credentials',()=>assert.throws(()=>validateBlinkUrl('https://user:pass@lnurl.blink.sv/status/token',{username,kind:'verify'}),/Unsafe/));
test('reject non-HTTPS verify URL',()=>assert.throws(()=>validateBlinkUrl('http://lnurl.blink.sv/status/token',{username,kind:'verify'}),/Unsafe/));
test('reject non-default port on verify URL',()=>assert.throws(()=>validateBlinkUrl('https://lnurl.blink.sv:444/status/token',{username,kind:'verify'}),/Unsafe/));
test('reject a root verify URL',()=>assert.throws(()=>validateBlinkUrl('https://lnurl.blink.sv/',{username,kind:'verify'}),/Unsafe verify path/));
test('reject fragment-bearing verify URL',()=>assert.throws(()=>validateBlinkUrl('https://lnurl.blink.sv/status/token#secret',{username,kind:'verify'}),/Unsafe/));
test('invoice response accepts opaque Blink verification route',()=>{
  const x=validateInvoiceResponse({pr:'lnbc10000n1'+'q'.repeat(30),verify:'https://lnurl.blink.sv/api/v2/settlement/opaque-hash?proof=123'}, {username,amountMsat:1_000_000});
  assert.equal(x.amountMsat,1_000_000);
  assert.equal(x.network,'mainnet');
});
