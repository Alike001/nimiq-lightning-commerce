// Explicit schema installation (idempotent, non-destructive).
import {initPreviewSchema} from '../neon-preview-store.mjs';
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing');
const url=new URL(process.env.DATABASE_URL);
if(!['postgresql:','postgres:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.searchParams.get('sslmode')!=='require')throw Error('Neon TLS URL required');
const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000});
try{await initPreviewSchema(pool);console.log('Nimlane preview schema is ready (no customer data modified).')}
finally{await pool.end()}
