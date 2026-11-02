#!/usr/bin/env node
// Issues one NEW UNPAID Blink invoice and checks binding and read-only settlement.
// No spending, signing, wallet connection, backend modification or delivery.
import {discover,issueUnpaidInvoice} from './blink-lnurl.mjs';
import {verifyInvoiceBinding,checkBlinkUnpaidStatus} from './blink-invoice-guard.mjs';
const username='alike';
const args=process.argv.slice(2);
async function main(){
 if(args.length!==2||args[0]!=='--unpaid'||!/^[1-9][0-9]*$/.test(args[1])){console.error('Usage: node scripts/blink-guard-preflight.mjs --unpaid 1000');process.exitCode=2;return}
 const sats=Number(args[1]);const metadata=await discover(username);
 const issued=await issueUnpaidInvoice(username,sats);
 const validated=verifyInvoiceBinding(issued.invoice,{amountMsat:sats*1000,metadata:metadata.metadata});
 const checked=await checkBlinkUnpaidStatus({username,verifyUrl:issued.verifyUrl,invoice:issued.invoice,paymentHash:validated.paymentHash}).catch(e=>({settled:false,safeToFulfill:false,reason:'CHECK_UNAVAILABLE',diagnostic:String(e.message).slice(0,100)}));
 // A fresh invoice is only a research proof; we NEVER fulfill even if Blink says paid.
 console.log(JSON.stringify({receiver:'alike@blink.sv',invoiceCreated:true,network:validated.network,amountSats:sats,bech32ChecksumVerified:true,invoiceAmountVerified:true,descriptionHashBoundToMerchant:true,invoiceExpiryVerified:true,paymentHashTagPresent:true,signatureCryptographicallyVerified:false,lud21VerifyUrlPresent:!!issued.verifyUrl,readOnlySettlementCheck:checked.reason,merchantReportsSettled:checked.settled===true,paymentSubmitted:false,fulfillmentEnabled:false},null,2));
 console.log('NO-SPEND PREVIEW ONLY: this script does not submit Lightning or NIM payments, or grant product access.');
}
main().catch(e=>{console.error('Blink guarded preflight failed:',e.message);process.exitCode=1});
