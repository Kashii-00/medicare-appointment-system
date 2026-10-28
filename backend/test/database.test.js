import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/oracle.js';
import { createService } from '../src/service.js';

function setup(execute = async () => ({ rows:[] })) {
  const events = [];
  const connection = {
    execute: async (...args) => { events.push('execute'); return execute(...args); },
    commit: async () => { events.push('commit'); },
    rollback: async () => { events.push('rollback'); },
    close: async () => { events.push('close'); }
  };
  const driver = { OUT_FORMAT_OBJECT:4002,CLOB:2017,thin:true,
    createPool: async () => ({ getConnection:async () => connection,close:async () => {} }) };
  const db = createDatabase({ timezone:'Asia/Colombo',user:'MEDICARE',password:'fake',connectString:'fake' },
    { driver, logger:{ error:() => {} } });
  return { db, connection, events };
}

test('a successful write commits once and releases its connection', async () => {
  const {db,events} = setup();
  await db.init();
  assert.equal(await db.withTransaction(async () => 42), 42);
  assert.deepEqual(events, ['commit','close']);
});

test('a failed write rolls back before releasing the connection and preserves the error', async () => {
  const {db,events} = setup();
  await db.init();
  const failure = new Error('business failure');
  await assert.rejects(db.withTransaction(async () => { throw failure; }), error => error === failure);
  assert.deepEqual(events, ['rollback','close']);
});

test('a commit failure also rolls back and releases the connection', async () => {
  const {db,connection,events} = setup();
  await db.init();
  connection.commit = async () => { events.push('commit'); throw new Error('commit failure'); };
  await assert.rejects(db.withTransaction(async () => 1), /commit failure/);
  assert.deepEqual(events, ['commit','rollback','close']);
});

test('read-only requests release connections without committing', async () => {
  const {db,events} = setup();
  await db.init();
  await db.withConnection(async () => 'data');
  assert.deepEqual(events, ['close']);
});

test('doctor and specialization changes roll back together if a selected specialization is invalid', async () => {
  let links = 0;
  const {db,events} = setup(async sql => {
    if (sql.startsWith('INSERT INTO doctors')) return { outBinds:{out_id:[42]} };
    if (sql.startsWith('INSERT INTO doctor_specializations')) {
      links++;
      if (links === 2) throw Object.assign(new Error('FK failure'), {errorNum:2291});
    }
    return {rows:[],rowsAffected:1};
  });
  await db.init();
  const service = createService(db);
  await assert.rejects(service.createMaster('doctors', { registration_no:'TEST',first_name:'Test',last_name:'Doctor',
    phone:'0110000001',specialization_ids:[1,999] }), error => error.errorNum === 2291);
  assert.equal(events.filter(event => event === 'commit').length, 0);
  assert.deepEqual(events.slice(-2), ['rollback','close']);
});

test('payment handling calls PL/SQL and binds reference text as data', async () => {
  const calls=[];
  const connection={ execute:async (sql,binds) => { calls.push({sql,binds}); return {outBinds:{out_id:77}}; } };
  const service=createService({withTransaction:work=>work(connection)});
  const reference="x'); DROP TABLE payments; --";
  assert.deepEqual(await service.recordPayment({appointment_id:5,amount:100,payment_method:'CASH',reference_no:reference}), {payment_id:77});
  assert.match(calls[0].sql, /mc_api\.record_payment/);
  assert.ok(!calls[0].sql.includes(reference));
  assert.equal(calls[0].binds.reference_no, reference);
});

test('report cursors are closed and truncation is explicit', async () => {
  let closed=0;
  const cursor={getRows:async () => [{N:1},{N:2},{N:3}], close:async () => {closed++;}};
  const service=createService({withConnection:work=>work({execute:async () => ({outBinds:{rows:cursor}})})});
  const result=await service.runReport('outstanding-balances',{limit:2});
  assert.equal(result.data.length,2);
  assert.equal(result.meta.truncated,true);
  assert.equal(closed,1);
});

test('report cursor cleanup runs when fetching fails', async () => {
  let closed=0;
  const cursor={getRows:async () => {throw new Error('fetch failed');},close:async () => {closed++;}};
  const service=createService({withConnection:work=>work({execute:async () => ({outBinds:{rows:cursor}})})});
  await assert.rejects(service.runReport('outstanding-balances',{limit:2}), /fetch failed/);
  assert.equal(closed,1);
});
