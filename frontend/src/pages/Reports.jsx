import { useState } from 'react';
import { useApi, useAll, useApp } from '../context.jsx';
import { addDays, dateOnly, dateTime, downloadCsv, fullName, money, number, queryString, reference, titleCase, today } from '../lib.js';
import { Badge, Button, Empty, ErrorNotice, Field, Icon, PageHeader, Table } from '../components/ui.jsx';

const reportDefinitions = [
  {name:'appointment-summary',title:'Appointments',description:'Daily bookings by clinic and status',icon:'calendar',dates:true},
  {name:'doctor-workload',title:'Doctor workload',description:'Pending and completed care',icon:'doctor',dates:true},
  {name:'clinic-revenue',title:'Clinic revenue',description:'Payments collected by facility',icon:'wallet',dates:true},
  {name:'outstanding-balances',title:'Outstanding fees',description:'Appointments with amounts due',icon:'chart'},
  {name:'patient-history',title:'Patient history',description:'Consultations and prescriptions',icon:'notes',patient:true}
];
const cashFields = new Set(['collected_lkr','agreed_fee','paid_amount','balance_due']);
function cellValue(key,value) {
  if (value===null || value===undefined) return '—';
  if (cashFields.has(key)) return <strong>{money(value)}</strong>;
  if (key==='status') return <Badge status={value} />;
  if (key.endsWith('_date')) return dateOnly(value);
  if (key.endsWith('_at') || key==='appointment_start') return dateTime(value);
  return <span className="wrap-cell">{String(value)}</span>;
}

function HistoryReport({ rows }) {
  const groups = Object.values(rows.reduce((result,row) => {
    result[row.consultation_id] ??= { ...row, medicines:[] };
    if (row.medicine_name) result[row.consultation_id].medicines.push(row);
    return result;
  },{})).sort((a,b) => Date.parse(b.appointment_start)-Date.parse(a.appointment_start));
  return <div className="history-report">{groups.map(row => <article className="history-card" key={row.consultation_id}><div className="subsection-heading"><div><span className="eyebrow">{reference('CON',row.consultation_id)}</span><h3>{dateTime(row.appointment_start)}</h3></div><span className="type-chip">Completed consultation</span></div>
    <p className="history-provider">Dr. {row.doctor_name} · {row.clinic_name}</p><div className="history-diagnosis"><span>Diagnosis</span><strong>{row.diagnosis}</strong>{row.symptoms && <p>{row.symptoms}</p>}</div>
    {row.follow_up_date && <p className="muted small-copy">Follow-up: {dateOnly(row.follow_up_date)}</p>}
    {row.medicines.length ? <div className="medicine-records">{row.medicines.map((item,index) => <div className="medicine-record" key={`${item.line_no}-${index}`}><span className="medicine-line"><Icon name="pill" size={16} /></span><div><strong>{item.medicine_name} · {item.strength}</strong><p>{item.dosage} · {item.frequency} · {item.duration_days} days</p>{item.instructions && <small>{item.instructions}</small>}</div></div>)}</div> : <p className="muted small-copy">No prescription recorded for this consultation.</p>}
  </article>)}</div>;
}

export default function Reports() {
  const { params } = useApp();
  const initial = reportDefinitions.some(row => row.name===params.get('report')) ? params.get('report') : 'appointment-summary';
  const [selected,setSelected] = useState(initial);
  const [from,setFrom] = useState(addDays(today(),-30));
  const [to,setTo] = useState(addDays(today(),30));
  const [patient,setPatient] = useState(params.get('patient_id') || '');
  const [requestPath,setRequestPath] = useState(initial==='patient-history' && params.get('patient_id') ? `/reports/patient-history?patient_id=${params.get('patient_id')}` : initial==='appointment-summary' ? `/reports/appointment-summary?from=${addDays(today(),-30)}&to=${addDays(today(),30)}` : null);
  const [validation,setValidation] = useState(null);
  const patients = useAll(selected==='patient-history' ? '/patients' : null);
  const result = useApi(requestPath);
  const definition = reportDefinitions.find(row => row.name===selected);
  const rows = requestPath ? result.data?.data || [] : [];
  function run(event) {
    event.preventDefault();setValidation(null);
    if (definition.dates && from>to) {setValidation('The start date must be on or before the end date.');return;}
    const query = definition.dates ? {from,to} : definition.patient ? {patient_id:patient} : {};
    const path = `/reports/${selected}${queryString(query)}`;
    if (path===requestPath) result.reload(); else setRequestPath(path);
  }
  const columns = rows.length ? Object.keys(rows[0]).map(key => ({key,label:titleCase(key).replace('Lkr','(LKR)'),render:row => cellValue(key,row[key])})) : [];
  return <><PageHeader title="Business reports" description="Turn appointment, payment and consultation records into useful summaries."><Button variant="secondary" icon="download" disabled={!rows.length || result.loading} onClick={() => downloadCsv(rows,`medicare-${selected}-${today()}.csv`)}>Export CSV</Button><Button variant="secondary" disabled={!rows.length || result.loading} onClick={() => window.print()}>Print report</Button></PageHeader>
    <div className="report-picker">{reportDefinitions.map(report => <button key={report.name} className={`report-choice ${report.name===selected?'active':''}`} aria-pressed={report.name===selected} onClick={() => {setSelected(report.name);setRequestPath(null);setValidation(null);}}><span className="report-choice-icon"><Icon name={report.icon} /></span><strong>{report.title}</strong><span>{report.description}</span></button>)}</div>
    <section className="card report-card"><form className="report-controls" onSubmit={run}><div><span className="eyebrow">SELECTED REPORT</span><h2>{definition.title}</h2></div><div className="report-fields">
      {definition.dates && <><Field label="From"><input type="date" required value={from} onChange={event => {setFrom(event.target.value);setRequestPath(null);}} /></Field><Field label="To"><input type="date" required min={from} value={to} onChange={event => {setTo(event.target.value);setRequestPath(null);}} /></Field></>}
      {definition.patient && <Field label="Patient" required><select required value={patient} onChange={event => {setPatient(event.target.value);setRequestPath(null);}}><option value="">Select a patient</option>{patients.data.map(row => <option key={row.patient_id} value={row.patient_id}>{fullName(row)}</option>)}</select></Field>}
      <Button type="submit" busy={result.loading} disabled={patients.loading}>Run report</Button></div></form>
      <div className="report-feedback"><ErrorNotice error={validation || result.error || patients.error} retry={result.error ? result.reload : patients.error ? patients.reload : null} /></div>
      {requestPath && !result.error && <div className="report-caption"><span>{definition.patient && rows.length ? rows[0].patient_name : definition.dates ? `${dateOnly(from)} – ${dateOnly(to)}` : 'All outstanding appointments'}</span><small>{number(rows.length)} result rows · Sri Lanka time</small></div>}
      {result.data?.meta?.truncated && requestPath && <p className="info-note report-truncation">Showing the first {result.data.meta.limit} rows. Narrow the filters for a smaller report. CSV exports contain the displayed rows.</p>}
      {selected==='patient-history' && rows.length && !result.loading ? <HistoryReport rows={rows} /> : <Table columns={columns} rows={rows} loading={result.loading} rowKey={selected==='outstanding-balances'?'appointment_id':undefined} caption={definition.title} empty={<Empty title={requestPath ? 'No results for this report' : 'Choose your filters, then run the report'} description={requestPath ? 'Try a different date range or patient.' : 'The results will appear here and can be exported to CSV.'} icon="chart" />} />}
    </section></>;
}
