import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createBookingHandlers,verifyTurnstile} from '../lib/booking-submit.mjs';

/* The submission pipeline is calendar-as-truth: a request is the Bookings
   Calendar event plus the owner email; booking_requests rows are no longer
   written (only reconciled/deleted). These suites therefore cover the
   request path's gates, not persistence. */

const schema=readFileSync(new URL('../migrations/0004_remove_hold.sql',import.meta.url),'utf8');
const calendarFixture=await (async()=>{
  const keyBytes=crypto.getRandomValues(new Uint8Array(32));
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('refresh:trial@example.com')},key,new TextEncoder().encode('local-fixture'));
  const b64=bytes=>Buffer.from(bytes).toString('base64');
  return {keyBytes,encrypted:`v1.${b64(iv)}.${b64(cipher)}`};
})();
const now=Math.floor(Date.now()/1000);
const date=new Date((now+10*86400)*1000).toISOString().slice(0,10);
const booking=()=>({package:'standard',count:2,date,time:900,details:{name:'Test Customer',email:'trial@example.com',phone:'704-555-0100',location:'UNC Charlotte campus',graduate:'Test Customer',notes:'<script>example</script>',participants:[]}});
function setup(options={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(schema);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS google_connections (
    account_email TEXT PRIMARY KEY, encrypted_refresh_token TEXT NOT NULL,
    granted_scopes TEXT, connected_at INTEGER, updated_at INTEGER)`);
  const tokenRow={encrypted_refresh_token:calendarFixture.encrypted};
  const db={prepare(sql){const statement=sqlite.prepare(sql);return {bind(...args){return {
    async first(){if(sql.includes('google_connections'))return tokenRow;return statement.get(...args)??null;},async run(){const r=statement.run(...args);return {success:true,meta:{changes:r.changes}};}
  };}};}};
  let checks=0,verifications=0;
  const handlers=createBookingHandlers({now:()=>now,
    readAvailability:async context=>{checks++;const url=new URL(context.request.url);return options.availability?.(context)??Response.json({source:'google',timeZone:'America/New_York',start:url.searchParams.get('start'),package:url.searchParams.get('package'),days:[{key:date,slots:[900,930]}]});},
    verify:async()=>{verifications++;if(options.rejectVerification)throw new Error('private verifier diagnostic');}});
  const env={BOOKING_SUBMISSIONS_ENABLED:'true',BOOKING_ALLOWED_EMAIL:'trial@example.com',BOOKING_DB:db,
    GOOGLE_ALLOWED_EMAIL:'trial@example.com',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.from(calendarFixture.keyBytes).toString('base64'),
    GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_BOOKINGS_CALENDAR_ID:'bookings'};
  globalThis.__eventCreates=0;
  globalThis.fetch=async(url,opts)=>{
    const target=String(url);
    if(target.includes('/token'))return Response.json({access_token:'local-token'});
    if(target.includes('/bookings/events')&&opts?.method==='POST'){globalThis.__eventCreates++;return Response.json({id:'event-'+globalThis.__eventCreates});}
    throw new Error('Unexpected fetch: '+target);
  };
  const request=(body,path='submit',changes={})=>new Request(`https://cyberflight.studio/api/booking/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://cyberflight.studio',...changes},body:JSON.stringify(body)});
  const context=(body,path='submit')=>({request:request(body,path),env});
  const submission=()=>({booking:booking(),promotion:'no',submissionKey:crypto.randomUUID(),turnstileToken:'test-token'});
  return {sqlite,handlers,env,context,request,submission,checks:()=>checks,verifications:()=>verifications};
}
test('Google rejection or outage leaves no saved request',async()=>{
  for(const availability of [()=>new Response('error',{status:503}),()=>Response.json({source:'google',timeZone:'America/New_York',start:date,package:'standard',days:[{key:date,slots:[]}]})]) {
    const s=setup({availability}),a=await s.submission();assert.ok([409,503].includes((await s.handlers.submit(s.context(a))).status));
    assert.equal(s.sqlite.prepare('SELECT count(*) n FROM booking_requests').get().n,0);s.sqlite.close();
  }
});
test('cross-origin and disabled feature fail before persistence',async()=>{
  const s=setup(),a=await s.submission();
  assert.equal((await s.handlers.submit({request:s.request(a,'submit',{Origin:'https://other.example'}),env:s.env})).status,403);
  s.env.BOOKING_SUBMISSIONS_ENABLED='false';assert.equal((await s.handlers.submit(s.context(a))).status,503);
  s.env.BOOKING_SUBMISSIONS_ENABLED='true';assert.equal((await s.handlers.submit(s.context(a))).status,201);s.sqlite.close();
});
test('bad JSON and oversized body return controlled errors',async()=>{
  const s=setup();for(const body of ['{',JSON.stringify({text:'a'.repeat(350001)})]) {
    const request=new Request('https://cyberflight.studio/api/booking/submit',{method:'POST',headers:{Origin:'https://cyberflight.studio','Content-Type':'application/json'},body});
    assert.ok([400,413].includes((await s.handlers.submit({request,env:s.env})).status));
  }s.sqlite.close();
});
test('Turnstile verifies success, exact hostname and booking action',async()=>{
  const original=globalThis.fetch;
  const request=new Request('https://cyberflight.studio/api/booking/submit');
  try {
    for(const response of [{success:true,hostname:'cyberflight.studio',action:'booking_submit'},
      {success:true,hostname:'other.example',action:'booking_submit'},
      {success:true,hostname:'cyberflight.studio',action:'contact'}, {success:false}]) {
      globalThis.fetch=async()=>Response.json(response);
      if(response.success&&response.hostname==='cyberflight.studio'&&response.action==='booking_submit') await verifyTurnstile(request,{TURNSTILE_SECRET:'secret'},'token');
      else await assert.rejects(()=>verifyTurnstile(request,{TURNSTILE_SECRET:'secret'},'token'),/verification_failed/);
    }
  }finally{globalThis.fetch=original;}
});
