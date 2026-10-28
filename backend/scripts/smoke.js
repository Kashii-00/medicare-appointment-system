// Read-only checks against the running backend and its real Oracle connection.
const base = process.env.API_BASE_URL || 'http://127.0.0.1:4000';
const localDay = instant => new Date(instant + 330 * 60000).toISOString().slice(0, 10);
const from = localDay(Date.now() - 365 * 86400000);
const to = localDay(Date.now() + 365 * 86400000);
async function get(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error?.message || 'failed'}`);
  console.log('PASS', path);
  return body;
}
try {
  const health = await get('/api/health');
  if (health.database !== 'connected') throw new Error('Database health was not confirmed.');
  await get('/api/dashboard');
  for (const name of ['patients','doctors','clinics','specializations','medicines','sessions','appointments','consultations','payments']) await get(`/api/${name}?limit=5`);
  const sessions = await get('/api/sessions?limit=1&upcoming=true');
  if (sessions.data.length) {
    const slots = (await get(`/api/sessions/${sessions.data[0].session_id}/slots`)).data;
    const expected = Math.floor((Date.parse(slots.session.end_time)-Date.parse(slots.session.start_time))/60000/slots.session.slot_minutes);
    if (slots.session.capacity !== expected || slots.slots.length !== expected) throw new Error('Session slot count does not match its duration.');
  }
  else console.log('SKIP slot check: no upcoming sessions.');
  for (const name of ['appointment-summary','doctor-workload','clinic-revenue']) await get(`/api/reports/${name}?from=${from}&to=${to}`);
  await get('/api/reports/outstanding-balances');
  const consultations = await get('/api/consultations?limit=1');
  const patients = await get('/api/patients?limit=1');
  const patientId = consultations.data[0]?.patient_id ?? patients.data[0]?.patient_id;
  if (patientId) await get(`/api/reports/patient-history?patient_id=${patientId}`);
  else console.log('SKIP patient history: no patients.');
  console.log('Read-only API smoke checks completed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
