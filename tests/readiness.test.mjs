import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessReadiness} from '../src/readiness.mjs';

test('outside Nimiq Pay remains unknown and no-spend',()=>{
 const r=assessReadiness({});assert.match(r.network,/not independently detected/);
 assert.match(r.method,/unavailable/);assert.equal(r.clearedForLivePayment,false);
});
test('detected mainnet does not claim route or fee validation',()=>{
 const r=assessReadiness({hostNetwork:'mainnet',providerAvailable:true,lightningMethodExposed:true});
 assert.match(r.network,/mainnet detected/);assert.match(r.method,/NOT tested/);
 assert.equal(r.clearedForLivePayment,false);
});
test('testnet versus merchant mainnet invoice explicitly mismatched',()=>{
 const r=assessReadiness({hostNetwork:'testnet',providerAvailable:true,order:{invoice:'lnbc100n1abc'}});
 assert.match(r.network,/not payable here/);assert.match(r.invoice,/invoice present/);
});
test('merchant invoice existence is not evidence of a successful swap',()=>{
 const r=assessReadiness({hostNetwork:'mainnet',order:{invoice:'lnbc100n1abc'}});
 assert.match(r.invoice,/not proof/);assert.match(r.settlement,/No independently verified/);
});
test('even observed proof cannot unlock preview or greenlight payment',()=>{
 const r=assessReadiness({hostNetwork:'mainnet',order:{settlementProofObserved:true}});
 assert.match(r.settlement,/remains locked/);assert.match(r.checkout,/DISABLED/);
 assert.equal(r.clearedForLivePayment,false);
});
test('flags cannot turn readiness diagnostics into authorization',()=>{
 const r=assessReadiness({hostNetwork:'mainnet',providerAvailable:true,lightningMethodExposed:true,previewOnly:false,walletEnabled:true});
 assert.match(r.checkout,/NOT CLEARED/);assert.equal(r.clearedForLivePayment,false);
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(main,/assessReadiness/);
});
