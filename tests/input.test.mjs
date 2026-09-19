import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBooking, normalizeSignature, sessionSeconds} from '../lib/booking-input.mjs';

const input = () => ({package:'standard',count:2,date:'2026-10-07',time:900,details:{
  name:'Cole',email:'test@example.com',phone:'704-555-0100',location:'UNC Charlotte campus',graduate:'Cole',notes:'',participants:[]}});
const sign = () => ({typedName:'Cole',agreementConsent:true,electronicConsent:true,promotion:null,drawing:[]});
test('server calculates price, duration, individual count and Eastern UTC offset',()=>{
  const b=normalizeBooking(input()); assert.equal(b.priceCents,20000); assert.equal(b.count,1);
  assert.equal(b.sessionEnd-b.sessionStart,5400); assert.equal(new Date(b.sessionStart*1000).toISOString(),'2026-10-07T19:00:00.000Z');
});
test('browser price injection and unknown package names fail',()=>{
  assert.throws(()=>normalizeBooking({...input(),priceCents:1}),/unexpected_fields/);
  assert.throws(()=>normalizeBooking({...input(),package:'__proto__'}),/invalid_package/);
});
test('group count, price and participant list must match',()=>{
  const p=input(); p.package='group'; p.count=3;
  assert.throws(()=>normalizeBooking(p),/invalid_participants/);
  p.details.participants=['A','B','C'].map(name=>({name,email:''}));
  assert.equal(normalizeBooking(p).priceCents,34000);
  p.count=5; assert.throws(()=>normalizeBooking(p),/invalid_group_size/);
});
test('required whitespace, bad email and oversized notes fail',()=>{
  for(const [key,value] of [['name',' '],['email','bad'],['notes','a'.repeat(1501)]]) {
    const p=input();p.details[key]=value;assert.throws(()=>normalizeBooking(p));
  }
});
test('nonexistent dates, spring gap, repeated fall hour and non-grid times fail',()=>{
  for(const [date,time] of [['2026-02-30',900],['2026-03-08',150],['2026-11-01',90],['2026-10-07',901]]) assert.throws(()=>sessionSeconds(date,time),/invalid_time/);
  assert.equal(new Date(sessionSeconds('2026-12-07',900)*1000).toISOString(),'2026-12-07T20:00:00.000Z');
});
test('consents must be true booleans and typed name is required',()=>{
  const b=normalizeBooking(input());
  for(const update of [{agreementConsent:false},{electronicConsent:'true'},{typedName:' '}]) assert.throws(()=>normalizeSignature({...sign(),...update},b));
});
test('organizer cannot grant another graduate portfolio permission',()=>{
  const p=input();p.details.graduate='Someone Else';
  assert.throws(()=>normalizeSignature({...sign(),promotion:'yes'},normalizeBooking(p)),/permission_requires_graduate/);
});
test('drawn signature retains points and rejects unbounded or invalid coordinates',()=>{
  const b=normalizeBooking(input()),drawing=[[[0,0],[0.5,0.7],[1,1]]];
  assert.deepEqual(normalizeSignature({...sign(),drawing},b).drawing,drawing);
  for(const drawing of [[[[2,0]]],[[[NaN,0]]],[Array.from({length:10001},()=>[0,0])]]) assert.throws(()=>normalizeSignature({...sign(),drawing},b));
});
