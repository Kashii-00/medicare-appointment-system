import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

async function fixture(t, overrides={}) {
  const calls=[];
  const service=new Proxy(overrides, {get(target,name) {
    if (name in target) return target[name];
    return async (...args) => {
      calls.push({name,args});
      if (name==='health') return {status:'ok',database:'connected'};
      if (name.startsWith('list')) return {data:[],pagination:{count:0}};
      if (name==='runReport') return {data:[],meta:{truncated:false}};
      return {id:42};
    };
  }});
  const server=createApp(service,{logger:{error:()=>{}}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(() => new Promise(resolve => {server.close(resolve);server.closeIdleConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path, method='GET', body, headers={}) {
    const response=await fetch(base+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
    return {response,body:await response.json()};
  }
  return {request,calls,base};
}

test('health reports database connectivity', async t => {
  const {request}=await fixture(t);
  const result=await request('/api/health');
  assert.equal(result.response.status,200);
  assert.equal(result.body.database,'connected');
});

test('patient creation preserves phone numbers as text and returns 201', async t => {
  const {request,calls}=await fixture(t);
  const result=await request('/api/patients','POST',{first_name:'Test',last_name:'Patient',date_of_birth:'2000-01-02',phone:'0700000001'});
  assert.equal(result.response.status,201);
  assert.equal(calls[0].args[1].phone,'0700000001');
});

test('unknown JSON columns and invalid IDs are rejected before database work', async t => {
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/patients','POST',{first_name:'Test',unknown_column:1})).response.status,400);
  assert.equal((await request('/api/patients/1%20OR%201=1')).response.status,400);
  assert.equal(calls.length,0);
});

test('booking cannot override the database fee or accept a fractional slot', async t => {
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/appointments','POST',{patient_id:1,session_id:2,slot_no:1,agreed_fee:1})).response.status,400);
  assert.equal((await request('/api/appointments','POST',{patient_id:1,session_id:2,slot_no:1.5})).response.status,400);
  assert.equal(calls.length,0);
});

test('valid booking forwards numeric IDs to the business service', async t => {
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/appointments','POST',{patient_id:'1',session_id:'2',slot_no:3})).response.status,201);
  assert.deepEqual(calls[0].args[0],{patient_id:1,session_id:2,slot_no:3});
});

test('Oracle booking conflicts reach the browser as 409 without PL/SQL stacks', async t => {
  const {request}=await fixture(t,{bookAppointment:async () => {throw Object.assign(new Error('ORA-20108: Slot is taken.\nORA-06512: private stack'),{errorNum:20108});}});
  const result=await request('/api/appointments','POST',{patient_id:1,session_id:2,slot_no:1});
  assert.equal(result.response.status,409);
  assert.equal(result.body.error.message,'Slot is taken.');
  assert.ok(result.body.error.request_id);
  assert.ok(!JSON.stringify(result.body).includes('private stack'));
});

test('invalid payment precision is rejected before database work', async t => {
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/payments','POST',{appointment_id:1,amount:0.001,payment_method:'CASH'})).response.status,400);
  assert.equal(calls.length,0);
});

test('report requests require valid ranges and a patient for patient history', async t => {
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/reports/appointment-summary?from=2026-10-28&to=2026-10-27')).response.status,400);
  assert.equal((await request('/api/reports/patient-history')).response.status,400);
  assert.equal((await request('/api/reports/not-a-report')).response.status,404);
  assert.equal(calls.length,0);
});

test('prescription lines are validated before serialization', async t => {
  const {request,calls}=await fixture(t);
  assert.equal((await request('/api/prescriptions','POST',{consultation_id:1,items:[]})).response.status,400);
  assert.equal((await request('/api/prescriptions','POST',{consultation_id:1,items:[{medicine_id:1,dosage:'Demo',frequency:'Demo',duration_days:1.5}]})).response.status,400);
  assert.equal(calls.length,0);
});

test('CORS permits the local frontend and rejects unrelated browser origins', async t => {
  const {request,calls}=await fixture(t);
  const allowed=await request('/api/health','GET',undefined,{Origin:'http://localhost:5173'});
  assert.equal(allowed.response.headers.get('access-control-allow-origin'),'http://localhost:5173');
  const before=calls.length;
  const rejected=await request('/api/appointments','POST',{patient_id:1,session_id:2,slot_no:1},{Origin:'https://unrelated.example'});
  assert.equal(rejected.response.status,403);
  assert.equal(calls.length,before);
});

test('malformed JSON and async database failures use structured error responses', async t => {
  const {request,base}=await fixture(t,{health:async () => {throw Object.assign(new Error('Sensitive credentials must never be returned'),{code:'NJS-503'});}});
  const malformed=await fetch(`${base}/api/appointments`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});
  assert.equal(malformed.status,400);
  assert.equal((await malformed.json()).error.code,'INVALID_JSON');
  const failed=await request('/api/health');
  assert.equal(failed.response.status,503);
  assert.ok(!JSON.stringify(failed.body).includes('Sensitive'));
});
