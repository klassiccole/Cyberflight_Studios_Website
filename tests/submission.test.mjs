import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createBookingHandlers,verifyTurnstile} from '../lib/booking-submit.mjs';
import {sha256} from '../lib/booking-input.mjs';

const schema=readFileSync(new URL('../migrations/0001_booking_requests.sql',import.meta.url),'utf8');
const now=Math.floor(Date.now()/1000);
const calendarFixture=await (async()=>{
  const keyBytes=crypto.getRandomValues(new Uint8Array(32));
  const key=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('refresh:trial@example.com')},key,new TextEncoder().encode('local-fixture'));
  const b64=bytes=>Buffer.from(bytes).toString('base64');
  return {keyBytes,encrypted:`v1.${b64(iv)}.${b64(cipher)}`};
})();
const date=new Date((now+10*86400)*1000).toISOString().slice(0,10);
const booking=()=>({package:'standard',count:2,date,time:900,details:{name:'Test Customer',email:'trial@example.com',phone:'704-555-0100',location:'UNC Charlotte campus',graduate:'Test Customer',notes:'<script>example</script>',participants:[]}});
const signature=()=>({typedName:'Test Customer',agreementConsent:true,electronicConsent:true,promotion:'no',drawing:[[[0,0],[0.5,0.8]]]});
function setup(options={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(schema);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS google_connections (
    account_email TEXT PRIMARY KEY, encrypted_refresh_token TEXT NOT NULL,
    granted_scopes TEXT, connected_at INTEGER, updated_at INTEGER)`);
  console.log('FIXTUREKEY-B64:',Buffer.from(calendarFixture.keyBytes).toString('base64').slice(0,20),'| ENCRYPTED-LEN:',calendarFixture.encrypted.length);
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
  globalThis.__fetchToken=0;
  globalThis.fetch=async(url,opts)=>{
    const target=String(url);
    if(target.includes('/token')){globalThis.__fetchToken++;return Response.json({access_token:'local-token'});}
    if(target.includes('/bookings/events')&&opts?.method==='POST'){globalThis.__eventCreates++;return Response.json({id:'event-'+globalThis.__eventCreates});}
    throw new Error('Unexpected fetch: '+target);
  };
  const request=(body,path='submit',changes={})=>new Request(`https://cyberflight.studio/api/booking/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://cyberflight.studio',...changes},body:JSON.stringify(body)});
  const context=(body,path='submit')=>({request:request(body,path),env});
  async function submission() {
    const agreement=await (await handlers.agreement(context({booking:booking()},'agreement'))).json();
    return {booking:booking(),signature:signature(),agreementVersion:agreement.version,agreementHash:agreement.hash,submissionKey:crypto.randomUUID(),turnstileToken:'test-token'};
  }
  return {sqlite,handlers,env,context,request,submission,checks:()=>checks,verifications:()=>verifications};
}
test('agreement is server generated, safely escaped and contains agreed 48-hour window',async()=>{
  const s=setup();const p=booking();p.details.name='<img src=x onerror=alert(1)>';
  const r=await s.handlers.agreement(s.context({booking:p},'agreement'));assert.equal(r.status,200);
  const a=await r.json();assert.ok(a.html.includes('&lt;img'));assert.ok(!a.html.includes('<img'));
  assert.ok(a.text.includes('48 hours before the requested session'));assert.ok(a.text.includes('72 hours before the session'));assert.ok(!('draft' in a));
  assert.equal(a.hash,await sha256(a.text));s.sqlite.close();
});
test('submission stores actual inputs, typed/drawn signature, immutable agreement and queues notification',async()=>{
  const s=setup();const input=await s.submission();const r=await s.handlers.submit(s.context(input));assert.equal(r.status,201);
  const receipt=await r.json(),row=s.sqlite.prepare('SELECT * FROM booking_requests').get();
  assert.equal(row.id,receipt.requestId);assert.equal(row.expires_at-row.created_at,172800);assert.equal(row.price_cents,20000);
  assert.equal(JSON.parse(row.customer_json).email,'trial@example.com');assert.equal(JSON.parse(row.signature_json).typedName,'Test Customer');
  assert.deepEqual(JSON.parse(row.signature_json).drawing,input.signature.drawing);assert.equal(row.agreement_sha256,await sha256(row.agreement_text));
  assert.deepEqual(s.sqlite.prepare('SELECT kind FROM booking_jobs ORDER BY kind').all().map(x=>x.kind),['approve_delivery','notify_owner']);assert.equal(s.checks(),1);s.sqlite.close();
});
test('lost-response retry returns same ID without another verification, calendar call or job',async()=>{
  const s=setup(),input=await s.submission();const a=await(await s.handlers.submit(s.context(input))).json();
  const r=await s.handlers.submit(s.context({...input,turnstileToken:'used-token'}));assert.equal(r.status,200);
  const b=await r.json();assert.equal(a.requestId,b.requestId);assert.equal(b.replayed,true);assert.equal(s.checks(),1);assert.equal(s.verifications(),1);
  assert.equal(s.sqlite.prepare('SELECT count(*) n FROM booking_jobs').get().n,2);s.sqlite.close();
});
test('idempotency key cannot be reused for changed signature or details',async()=>{
  const s=setup(),p=await s.submission();await s.handlers.submit(s.context(p));p.signature.typedName='Different Name';
  assert.equal((await s.handlers.submit(s.context(p))).status,409);s.sqlite.close();
});
test('simultaneous requests for overlapping slots save exactly one hold and one job',async()=>{
  const s=setup(),a=await s.submission(),b=await s.submission();
  const results=await Promise.all([s.handlers.submit(s.context(a)),s.handlers.submit(s.context(b))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(s.sqlite.prepare('SELECT count(*) n FROM booking_requests').get().n,1);
  assert.equal(s.sqlite.prepare('SELECT count(*) n FROM booking_jobs').get().n,2);s.sqlite.close();
});
test('same-key concurrent requests converge on one receipt',async()=>{
  const s=setup(),a=await s.submission();const responses=await Promise.all([s.handlers.submit(s.context(a)),s.handlers.submit(s.context(a))]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);const data=await Promise.all(responses.map(r=>r.json()));
  assert.equal(data[0].requestId,data[1].requestId);s.sqlite.close();
});
test('changed agreement cannot be signed without review',async()=>{
  const s=setup(),a=await s.submission();a.agreementHash='0'.repeat(64);
  assert.equal((await s.handlers.submit(s.context(a))).status,409);assert.equal(s.checks(),0);s.sqlite.close();
});
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
