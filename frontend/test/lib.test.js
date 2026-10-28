import test from 'node:test';
import assert from 'node:assert/strict';
import { api, allRows, addDays, canConsult, csvText, dateOnly, dateTime, localId, queryString } from '../src/lib.js';

test('calendar-only dates are not shifted by the computer timezone', () => {
  const old = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try { assert.equal(dateOnly('2026-10-27'), '27 Oct 2026'); }
  finally { if (old===undefined) delete process.env.TZ; else process.env.TZ=old; }
});
test('UTC timestamps are displayed in Sri Lanka time', () => {
  assert.match(dateTime('2026-10-27T18:30:00Z'), /28 Oct 2026/);
});
test('date ranges cross month and leap-year boundaries correctly', () => {
  assert.equal(addDays('2024-02-28',1),'2024-02-29');
  assert.equal(addDays('2026-12-31',1),'2027-01-01');
  assert.equal(addDays('2026-03-01',-1),'2026-02-28');
});
test('query parameters encode values without adding empty filters', () => {
  assert.equal(queryString({q:'A & B',from:'',patient_id:4,limit:10,none:null}),'?q=A+%26+B&patient_id=4&limit=10');
});
test('consultation eligibility excludes future and final appointments', () => {
  assert.equal(canConsult({status:'CONFIRMED',appointment_start:'2000-01-01T00:00:00Z'}),true);
  assert.equal(canConsult({status:'COMPLETED',appointment_start:'2000-01-01T00:00:00Z'}),false);
  assert.equal(canConsult({status:'BOOKED',appointment_start:'2999-01-01T00:00:00Z'}),false);
});
test('CSV escapes delimiters, quotes, line breaks and spreadsheet formulas', () => {
  const csv = csvText([{name:'A,"B"',note:'Line 1\nLine 2',formula:' =1+1',negative:'-1',empty:null}]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"A,""B"""'));
  assert.ok(csv.includes('"Line 1\nLine 2"'));
  assert.ok(csv.includes('"\' =1+1"'));
  assert.ok(csv.includes('"\'-1"'));
});
test('temporary UI IDs work when crypto.randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  try {
    const first=localId(),second=localId();
    assert.notEqual(first,second);
    assert.match(first,/^mc-/);
  } finally { if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto; }
});
test('API errors preserve business messages and status codes', async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Slot is taken.',code:'ORA-20108'}}),{status:409,headers:{'Content-Type':'application/json'}});
  try { await assert.rejects(api('/appointments'),error=>error.message==='Slot is taken.'&&error.status===409&&error.code==='ORA-20108'); }
  finally {globalThis.fetch=previous;}
});
test('interrupted requests preserve AbortError for hook cleanup', async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>{throw new DOMException('Cancelled','AbortError');};
  try {await assert.rejects(api('/patients'),error=>error.name==='AbortError');}
  finally {globalThis.fetch=previous;}
});
test('lookup loading follows every page instead of silently stopping at 200 records', async () => {
  const previous=globalThis.fetch;
  const urls=[];
  globalThis.fetch=async url=>{
    urls.push(url);
    const offset=new URL(url,'http://test.local').searchParams.get('offset');
    return new Response(JSON.stringify(offset==='0'?{data:[{id:1},{id:2}],pagination:{has_more:true}}:{data:[{id:3}],pagination:{has_more:false}}),{headers:{'Content-Type':'application/json'}});
  };
  try {
    assert.deepEqual(await allRows('/patients?active_flag=Y'),[{id:1},{id:2},{id:3}]);
    assert.match(urls[1],/offset=2/);
  } finally {globalThis.fetch=previous;}
});
test('malformed API responses are explained instead of treated as empty data', async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response('<html>Proxy error</html>',{status:502});
  try {await assert.rejects(api('/dashboard'),error=>error.code==='INVALID_RESPONSE');}
  finally {globalThis.fetch=previous;}
});
