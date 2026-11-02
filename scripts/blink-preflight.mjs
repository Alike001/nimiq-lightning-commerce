#!/usr/bin/env node
// Public LNURL-pay test only. Does not pay, sign, or spend anything.
import {discover,issueUnpaidInvoice} from './blink-lnurl.mjs';
const username='alike';
const args=process.argv.slice(2);
async function main(){
  if(args[0]==='--metadata'){
    const x=await discover(username);
    console.log(JSON.stringify({receiver:`${username}@blink.sv`,mode:'metadata-only',minSats:x.minMsat/1000,maxSats:x.maxMsat/1000,hasCallback:!!x.callback,paymentSubmitted:false},null,2));
  }else if(args[0]==='--mint'&&args.length===2&&/^[1-9]\d*$/.test(args[1])){
    const sats=Number(args[1]);
    const x=await issueUnpaidInvoice(username,sats);
    console.log(JSON.stringify({receiver:`${username}@blink.sv`,mode:'invoice-created-unpaid',amountSats:x.amountMsat/1000,network:x.network,bolt11Present:!!x.invoice,lud21VerifyUrlPresent:!!x.verifyUrl,fullInvoiceValidation:false,settlementVerified:false,paymentSubmitted:false,safeToFulfill:false},null,2));
    console.log('RESEARCH ONLY: Invoice issued but NOT paid. BOLT11 signature, tags, expiry and merchant binding require implementation before checkout integration.');
  }else{
    console.error('Usage: node scripts/blink-preflight.mjs --metadata | --mint 1000');
    process.exitCode=2;
  }
}
main().catch(e=>{console.error('Blink preflight failed:',e instanceof Error?e.message:'Unknown failure');process.exitCode=1});
