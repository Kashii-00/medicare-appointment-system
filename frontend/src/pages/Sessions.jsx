import { useState } from 'react';
import { useApi, useAll, useApp } from '../context.jsx';
import { api, addDays, dateTime, fullName, money, queryString, timeOnly, today } from '../lib.js';
import { Badge, Button, Dialog, Empty, ErrorNotice, Field, Icon, Loading, PageHeader, Pagination, Person, Table } from '../components/ui.jsx';

export default function Sessions() {
  const { setModal, params } = useApp();
  const [filters, setFilters] = useState({ doctor_id:params.get('doctor_id') || '',clinic_id:'',status:'',from:'',to:'' });
  const [offset, setOffset] = useState(0);
  const doctors = useAll('/doctors');
  const clinics = useAll('/clinics');
  const records = useApi(`/sessions${queryString({...filters,limit:10,offset})}`);
  const filter = (key,value) => {setFilters(previous => ({...previous,[key]:value}));setOffset(0);};
  return <>
    <PageHeader title="Doctor sessions" description="Set availability, manage fees and see how each session is filling up."><Button icon="plus" onClick={() => setModal({type:'session',doctor_id:filters.doctor_id})}>Add session</Button></PageHeader>
    <ErrorNotice error={records.error || doctors.error || clinics.error} retry={() => {records.reload();doctors.reload();clinics.reload();}} />
    <section className="card"><div className="filter-bar">
      <Field label="Doctor"><select value={filters.doctor_id} onChange={event => filter('doctor_id',event.target.value)}><option value="">All doctors</option>{doctors.data.map(row => <option key={row.doctor_id} value={row.doctor_id}>Dr. {fullName(row)}</option>)}</select></Field>
      <Field label="Facility"><select value={filters.clinic_id} onChange={event => filter('clinic_id',event.target.value)}><option value="">All facilities</option>{clinics.data.map(row => <option key={row.clinic_id} value={row.clinic_id}>{row.clinic_name}</option>)}</select></Field>
      <Field label="Status"><select value={filters.status} onChange={event => filter('status',event.target.value)}><option value="">All statuses</option>{['SCHEDULED','COMPLETED','CANCELLED'].map(status => <option key={status}>{status}</option>)}</select></Field>
      <Field label="From"><input type="date" value={filters.from} onChange={event => filter('from',event.target.value)} /></Field>
      <Field label="To"><input type="date" value={filters.to} min={filters.from} onChange={event => filter('to',event.target.value)} /></Field>
    </div><Table rows={records.data?.data || []} rowKey="session_id" loading={records.loading} caption="Doctor sessions" columns={[
      {key:'doctor_name',label:'Doctor & facility',render:row => <Person name={`Dr. ${row.doctor_name}`} secondary={row.clinic_name} id={row.doctor_id} />},
      {key:'start_time',label:'Session time',render:row => <><strong>{dateTime(row.start_time)}</strong><span className="cell-secondary">Until {timeOnly(row.end_time)} · {row.slot_minutes}-minute slots</span></>},
      {key:'capacity',label:'Bookings',render:row => <div className="capacity-cell"><strong>{row.booked_slots}<span> / {row.capacity}</span></strong><span className="progress-track"><span style={{width:`${Math.min(100,row.booked_slots/Math.max(1,row.capacity)*100)}%`}} /></span></div>},
      {key:'consultation_fee',label:'Fee',render:row => money(row.consultation_fee)},
      {key:'status',label:'Status',render:row => <Badge status={row.status} />},
      {key:'actions',label:'Actions',className:'actions-cell',render:row => <div className="row-actions"><button className="text-button" onClick={() => setModal({type:'slots',session_id:row.session_id})}>View slots</button>{row.status === 'SCHEDULED' && <><button className="text-button muted" onClick={() => setModal({type:'session-fee',record:row})}>Edit fee</button><button className="text-button muted" onClick={() => setModal({type:'session-cancel',record:row})}>Cancel</button>{Date.parse(row.end_time)<=Date.now() && <button className="text-button" onClick={() => setModal({type:'session-complete',record:row})}>Complete</button>}</>}</div>}
    ]} empty={<Empty title="No sessions match these filters" description="Try another date range or add a doctor session." icon="calendar" />} />
    <Pagination pagination={records.data?.pagination} offset={offset} onChange={setOffset} /></section>
  </>;
}

export function SessionDialog({ doctor_id, onClose }) {
  const { done } = useApp();
  const doctors = useAll('/doctors?active_flag=Y');
  const clinics = useAll('/clinics?active_flag=Y');
  const tomorrow = addDays(today(),1);
  const [values,setValues] = useState({doctor_id:doctor_id || '',clinic_id:'',start_time:`${tomorrow}T16:00`,end_time:`${tomorrow}T18:00`,slot_minutes:15,consultation_fee:''});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const update = (key,value) => setValues(previous => ({...previous,[key]:value}));
  async function submit(event) {
    event.preventDefault();setError(null);setBusy(true);
    try {await api('/sessions',{method:'POST',body:{...values,doctor_id:Number(values.doctor_id),clinic_id:Number(values.clinic_id),slot_minutes:Number(values.slot_minutes),consultation_fee:Number(values.consultation_fee)}});done('Doctor session added.');}
    catch (failure) {setError(failure);}finally {setBusy(false);}
  }
  return <Dialog title="Add doctor session" subtitle="Times use Sri Lanka time. Overlapping sessions for the same doctor are rejected." onClose={onClose} busy={busy}><form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error || doctors.error || clinics.error} />
    <div className="form-grid"><Field label="Doctor" required><select required value={values.doctor_id} onChange={event => update('doctor_id',event.target.value)}><option value="">Select a doctor</option>{doctors.data.map(row => <option key={row.doctor_id} value={row.doctor_id}>Dr. {fullName(row)}</option>)}</select></Field>
    <Field label="Facility" required><select required value={values.clinic_id} onChange={event => update('clinic_id',event.target.value)}><option value="">Select a facility</option>{clinics.data.map(row => <option key={row.clinic_id} value={row.clinic_id}>{row.clinic_name}</option>)}</select></Field>
    <Field label="Start time" required><input type="datetime-local" required value={values.start_time} onChange={event => update('start_time',event.target.value)} /></Field>
    <Field label="End time" required><input type="datetime-local" required min={values.start_time} value={values.end_time} onChange={event => update('end_time',event.target.value)} /></Field>
    <Field label="Slot length (minutes)" required><input type="number" min="5" max="120" step="1" required value={values.slot_minutes} onChange={event => update('slot_minutes',event.target.value)} /></Field>
    <Field label="Consultation fee (LKR)" required><input type="number" min="0" max="99999999.99" step="0.01" required value={values.consultation_fee} onChange={event => update('consultation_fee',event.target.value)} /></Field></div>
    {(doctors.loading || clinics.loading) && <Loading label="Loading doctors and facilities…" />}
  </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={doctors.loading || clinics.loading || doctors.error || clinics.error}>Add session</Button></div></form></Dialog>;
}

export function SlotGrid({ slots, selected, onSelect, readonly = false }) {
  return <div className="slot-grid">{slots.map(slot => <button type="button" key={slot.slot_no} className={`slot ${slot.available === 'Y' ? 'available' : 'unavailable'} ${Number(selected) === slot.slot_no ? 'selected' : ''}`}
    disabled={slot.available !== 'Y' || readonly} aria-pressed={Number(selected) === slot.slot_no} onClick={() => onSelect(slot.slot_no)}>
    <span>Slot {slot.slot_no}</span><strong>{timeOnly(slot.start_time)}</strong><small>{slot.available === 'Y' ? 'Available' : slot.appointment_id ? 'Booked' : 'Closed'}</small></button>)}</div>;
}

export function SlotsDialog({ session_id, onClose }) {
  const { setModal } = useApp();
  const result = useApi(`/sessions/${session_id}/slots`);
  return <Dialog title="Session availability" subtitle="Choose an available slot to book an appointment." onClose={onClose} wide><div className="dialog-body"><ErrorNotice error={result.error} retry={result.reload} />
    {result.loading ? <Loading /> : result.data && <><div className="session-info"><div><span className="eyebrow">DOCTOR SESSION</span><h3>{dateTime(result.data.data.session.start_time)}</h3><p>{result.data.data.session.slot_minutes}-minute slots · {money(result.data.data.session.consultation_fee)}</p></div><Badge status={result.data.data.session.status} /></div>
      <SlotGrid slots={result.data.data.slots} onSelect={slot_no => setModal({type:'booking',session_id,slot_no})} />
      {!result.data.data.slots.some(slot => slot.available === 'Y') && <p className="info-note">There are no available slots in this session.</p>}</>}
  </div><div className="dialog-footer"><Button variant="secondary" onClick={onClose}>Close</Button></div></Dialog>;
}

export function BookingDialog({ session_id = '', slot_no = '', onClose }) {
  const { done, navigate } = useApp();
  const patients = useAll('/patients?active_flag=Y');
  const sessions = useAll('/sessions?upcoming=true');
  const [patient,setPatient] = useState('');
  const [session,setSession] = useState(String(session_id));
  const [slot,setSlot] = useState(slot_no);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const slots = useApi(session ? `/sessions/${session}/slots` : null);
  const selectedSession = sessions.data.find(row => row.session_id === Number(session));
  const selectedSlot = slots.data?.data.slots.find(row => row.slot_no === Number(slot) && row.available === 'Y');
  async function submit(event) {
    event.preventDefault();setError(null);
    if (!selectedSlot) {setError('Choose an available appointment slot.');return;}
    setBusy(true);
    try {await api('/appointments',{method:'POST',body:{patient_id:Number(patient),session_id:Number(session),slot_no:Number(slot)}});done('Appointment booked successfully.');}
    catch (failure) {setError(failure);slots.reload();setSlot('');}finally {setBusy(false);}
  }
  return <Dialog title="Book an appointment" subtitle="Choose a patient, doctor session and available time." onClose={onClose} busy={busy} wide><form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error || patients.error || sessions.error || slots.error} />
    <div className="form-grid"><Field label="Patient" required><select required value={patient} onChange={event => setPatient(event.target.value)}><option value="">Select a patient</option>{patients.data.map(row => <option key={row.patient_id} value={row.patient_id}>{fullName(row)} · {row.phone}</option>)}</select></Field>
      <Field label="Doctor session" required><select required value={session} onChange={event => {setSession(event.target.value);setSlot('');setError(null);}}><option value="">Select a session</option>{sessions.data.map(row => <option key={row.session_id} value={row.session_id}>Dr. {row.doctor_name} · {dateTime(row.start_time)} · {row.clinic_name}</option>)}</select></Field></div>
    {(patients.loading || sessions.loading) && <Loading label="Loading booking options…" />}
    {!patients.loading && !patients.data.length && !patients.error && <Empty title="Register a patient first" description="A patient record is needed before an appointment can be booked." action={<Button type="button" variant="secondary" onClick={() => {onClose();navigate('patients');}}>Go to patients</Button>} />}
    {!sessions.loading && !sessions.data.length && !sessions.error && <p className="info-note">No upcoming sessions are available. Add a doctor session to open bookings.</p>}
    {session && <div className="booking-slots"><div className="subsection-heading"><h3>Choose a time</h3><span>Sri Lanka time</span></div>{slots.loading ? <Loading label="Checking available slots…" /> : slots.data && <SlotGrid slots={slots.data.data.slots} selected={slot} onSelect={setSlot} />}</div>}
    {selectedSession && <div className="booking-total"><span>Consultation fee</span><strong>{money(selectedSession.consultation_fee)}</strong><small>The fee is confirmed when your booking is saved.</small></div>}
  </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={!patient || !selectedSlot || patients.loading || sessions.loading}>Book appointment</Button></div></form></Dialog>;
}
