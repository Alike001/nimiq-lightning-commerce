// Public, no-spend Nimlane preview. Not a production payment service.
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {createNeonPreviewStore} from './neon-preview-store.mjs';
import {createNeonPreviewHandler} from './neon-preview-app.mjs';
import {validateUsername} from './scripts/blink-lnurl.mjs';
if(process.env.ENABLE_WALLET_PAY==='1'||process.env.ENABLE_BLINK_FULFILLMENT==='1'||process.env.ENABLE_BLINK_TEST_FULFILLMENT==='1')
  throw Error('Cloud preview forbids wallet payments and fulfillment');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required for Neon preview');
const url=new URL(process.env.DATABASE_URL);
if(!['postgresql:','postgres:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||
   url.searchParams.get('sslmode')!=='require')throw Error('DATABASE_URL must be a TLS-enabled Neon Postgres URL');
// The driver is imported dynamically so the existing SQLite-only suite requires no Postgres package.
const {default:pg}=await import('pg');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:20000});
await pool.query('SELECT 1'); // Read-only readiness check. Schema migration is opt-in.
const store=createNeonPreviewStore(pool);
const handler=createNeonPreviewHandler({store,root:resolve(import.meta.dirname),
 username:validateUsername(process.env.BLINK_USERNAME||'alike'),
 sats:Number(process.env.BLINK_PREVIEW_SATS||1000),ordersEnabled:process.env.ENABLE_BLINK_PREVIEW_ORDERS==='1'});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8794);
const server=createServer(handler);
server.listen(port,host,()=>console.log(`Nimlane Neon preview on ${host}:${port}; orders:${process.env.ENABLE_BLINK_PREVIEW_ORDERS==='1'?'ON':'OFF'}; wallet:OFF; delivery:OFF`));
for(const sig of ['SIGTERM','SIGINT'])process.once(sig,async()=>{server.close();await pool.end();process.exit(0)});
