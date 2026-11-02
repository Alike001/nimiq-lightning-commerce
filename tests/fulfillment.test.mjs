import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openDb,recordFulfillment,tokenHash} from '../db.mjs';
test('a single merchant settlement grants durable entitlement exactly once',()=>{
 const d=mkdtempSync(join(tmpdir(),'nim-commerce-'));const db=openDb(d);
 try{db.prepare('INSERT INTO orders(id,token_hash,sku,invoice_id,created_at) VALUES(?,?,?,?,?)').run('NLC-order','hash','merchant-operations-pack-v1','invoice-abc',123);
 assert.equal(recordFulfillment(db,'NLC-order',456),true);
 assert.equal(recordFulfillment(db,'NLC-order',457),false);
 assert.equal(db.prepare('SELECT fulfilled_at FROM orders WHERE id=?').get('NLC-order').fulfilled_at,456);
 assert.equal(recordFulfillment(db,'unknown',444),false);
 assert.equal(tokenHash('secret'),tokenHash('secret'));assert.notEqual(tokenHash('secret'),tokenHash('other'));
 }finally{db.close();rmSync(d,{recursive:true,force:true})}
});
