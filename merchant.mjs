import {resolve} from 'node:path';
import {openDb} from './db.mjs';
const db=openDb(resolve(import.meta.dirname));
const cmd=process.argv[2];
if(cmd==='summary'){
 console.log(JSON.stringify(db.prepare('SELECT COUNT(*) orders, SUM(fulfilled_at IS NOT NULL) fulfillments, SUM(attempt_status IS NOT NULL) attempted FROM orders').get(),null,2));
}else if(cmd==='orders'){
 console.table(db.prepare('SELECT id, sku, datetime(created_at,\'unixepoch\') created, last_merchant_status merchant, attempt_status attempt, fulfilled_at IS NOT NULL delivered FROM orders ORDER BY created_at DESC LIMIT 30').all());
}else{console.error('Usage: npm run merchant:orders | npm run merchant:summary');process.exitCode=1}
db.close();
