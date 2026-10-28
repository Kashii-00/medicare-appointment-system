import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOnly, clinicTimestamp, integer, money, master } from '../src/validation.js';
import { normalizeRows } from '../src/serialization.js';
import { publicError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';

test('calendar dates reject normalized impossible dates and accept leap days', () => {
  assert.equal(dateOnly('2024-02-29', 'date'), '2024-02-29');
  for (const value of ['2026-02-29','2026-04-31','2026-13-01','0000-01-01','27/10/2026']) {
    assert.throws(() => dateOnly(value, 'date'));
  }
});

test('session inputs are local whole-second timestamps, with no implicit timezone shift', () => {
  assert.equal(clinicTimestamp('2026-10-27T16:30', 'start'), '2026-10-27T16:30:00');
  for (const value of ['2026-10-27T16:30Z','2026-10-27T24:00','2026-10-27T12:61','2026-10-27T16:30:00.123']) {
    assert.throws(() => clinicTimestamp(value, 'start'));
  }
});

test('IDs reject injection, exponent/hex notation and unsafe or fractional numbers', () => {
  assert.equal(integer('42', 'id'), 42);
  for (const value of ['1 OR 1=1','0x10','1e3',' ',{},true,NaN,1.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => integer(value, 'id'));
  }
});

test('money validation preserves two-decimal amounts and rejects invalid payments', () => {
  assert.equal(money(10.25), 10.25);
  assert.equal(money(0.1 + 0.2), 0.3);
  assert.equal(money(0, 'fee', { allowZero: true }), 0);
  for (const value of [0,-1,1.001,Infinity,'100',100000000]) assert.throws(() => money(value));
});

test('master data cannot inject columns, omit required relations or use duplicate specializations', () => {
  const doctor = { registration_no:'TEST',first_name:'Test',last_name:'Doctor',phone:'0110000001',specialization_ids:[1] };
  assert.deepEqual(master('doctors', doctor).specialization_ids, [1]);
  assert.throws(() => master('doctors', { ...doctor, specialization_ids:[] }));
  assert.throws(() => master('doctors', { ...doctor, specialization_ids:[1,1] }));
  assert.throws(() => master('doctors', { ...doctor, 'doctor_id=1; DROP TABLE doctors': 1 }));
  assert.throws(() => master('patients', { date_of_birth:'2999-01-01' }, { partial:true }));
});

test('date-only Oracle fields retain their Sri Lanka calendar day in JSON', () => {
  const [row] = normalizeRows([{ DATE_OF_BIRTH:new Date('2000-01-01T18:30:00Z'),
    APPOINTMENT_START:new Date('2026-10-27T10:30:00Z'), DOCTOR_ID:42 }]);
  assert.equal(row.date_of_birth, '2000-01-02');
  assert.equal(row.appointment_start, '2026-10-27T10:30:00.000Z');
  assert.equal(row.doctor_id, 42);
});

test('Oracle business errors map to useful HTTP responses without stack disclosure', () => {
  assert.equal(publicError({ errorNum:20108,message:'ORA-20108: Slot is taken.\nORA-06512: private stack' }).status, 409);
  assert.equal(publicError({ errorNum:20101,message:'ORA-20101: Patient not found.' }).status, 404);
  assert.equal(publicError({ errorNum:2292 }).status, 409);
  const result = publicError({ code:'NJS-503', message:'Sensitive connection details' });
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result).includes('Sensitive'));
});

test('startup requires a real local password and rejects malformed frontend origins', () => {
  assert.throws(() => loadConfig({ DB_PASSWORD:'YOUR_MEDICARE_PASSWORD' }));
  assert.throws(() => loadConfig({ DB_PASSWORD:'test', CORS_ORIGINS:'http://localhost:5173/path' }));
  assert.equal(loadConfig({ DB_PASSWORD:'test' }).host, '127.0.0.1');
});
