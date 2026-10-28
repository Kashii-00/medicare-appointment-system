import { useState } from 'react';
import { useApi, useAll, useApp } from '../context.jsx';
import { api, canConsult, dateTime, fullName, money, queryString, reference } from '../lib.js';
import { AmountSummary, Badge, Button, Dialog, Empty, ErrorNotice, Field, Icon, Loading, PageHeader, Pagination, Person, Table } from '../components/ui.jsx';
import { ConsultationContent } from './Clinical.jsx';

export default function Appointments() {
  const { setModal } = useApp();
  const patients = useAll('/patients');
  const [filters,setFilters] = useState({patient_id:'',status:'',from:'',to:''});
  const [offset,setOffset] = useState(0);
  const result = useApi(`/appointments${queryString({...filters,limit:10,offset})}`);
  const filter = (key,value) => {setFilters(previous => ({...previous,[key]:value}));setOffset(0);};
  return <><PageHeader title="Appointments" description="Follow every booking from its first confirmation to completed care."><Button icon="plus" onClick={() => setModal({type:'booking'})}>Book appointment</Button></PageHeader>
    <ErrorNotice error={result.error || patients.error} retry={() => {result.reload();patients.reload();}} />
    <section className="card"><div className="filter-bar"><Field label="Patient"><select value={filters.patient_id} onChange={event => filter('patient_id',event.target.value)}><option value="">All patients</option>{patients.data.map(row => <option key={row.patient_id} value={row.patient_id}>{fullName(row)}</option>)}</select></Field>
      <Field label="Status"><select value={filters.status} onChange={event => filter('status',event.target.value)}><option value="">All statuses</option>{['BOOKED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'].map(status => <option key={status}>{status}</option>)}</select></Field>
      <Field label="From"><input type="date" value={filters.from} onChange={event => filter('from',event.target.value)} /></Field>
      <Field label="To"><input type="date" value={filters.to} min={filters.from} onChange={event => filter('to',event.target.value)} /></Field></div>
    <Table rows={result.data?.data || []} rowKey="appointment_id" loading={result.loading} caption="Appointments" columns={[
      {key:'patient_name',label:'Patient',render:row => <Person name={row.patient_name} secondary={reference('APT',row.appointment_id)} id={row.patient_id} />},
      {key:'doctor_name',label:'Doctor & facility',render:row => <><strong>Dr. {row.doctor_name}</strong><span className="cell-secondary">{row.clinic_name}</span></>},
      {key:'appointment_start',label:'Appointment',render:row => <>{dateTime(row.appointment_start)}<span className="cell-secondary">Slot {row.slot_no}</span></>},
      {key:'status',label:'Status',render:row => <Badge status={row.status} />},
      {key:'balance_due',label:'Balance',render:row => <><strong className={row.balance_due > 0 ? 'amount-due' : ''}>{money(row.balance_due)}</strong><span className="cell-secondary">Fee {money(row.agreed_fee)}</span></>},
      {key:'actions',label:'',render:row => <button className="text-button" onClick={() => setModal({type:'appointment',appointment_id:row.appointment_id})}>View details <Icon name="chevron" size={15} /></button>}
    ]} empty={<Empty title="No appointments match these filters" description="Choose another date or create a new booking." icon="calendar" />} />
    <Pagination pagination={result.data?.pagination} offset={offset} onChange={setOffset} /></section></>;
}

export function AppointmentDialog({ appointment_id, onClose }) {
  const { setModal, refresh, toast, navigate } = useApp();
  const result = useApi(`/appointments/${appointment_id}`);
  const row = result.data?.data;
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  async function confirm() {
    setBusy(true);setError(null);
    try {await api(`/appointments/${appointment_id}/confirm`,{method:'PATCH',body:{}});refresh();toast('Appointment confirmed.');}
    catch(failure) {setError(failure);}finally{setBusy(false);}
  }
  return <Dialog title={`Appointment ${reference('APT',appointment_id)}`} subtitle="Booking details, consultation history and payment balance." onClose={onClose} wide busy={busy}><div className="dialog-body"><ErrorNotice error={error || result.error} retry={result.error ? result.reload : null} />
    {result.loading ? <Loading /> : row && <><div className="record-banner"><Person name={row.patient_name} secondary={`Dr. ${row.doctor_name}`} id={row.patient_id} /><Badge status={row.status} /></div>
      <div className="detail-grid"><div><span>Facility</span><strong>{row.clinic_name}</strong></div><div><span>Appointment time</span><strong>{dateTime(row.appointment_start)}</strong></div><div><span>Slot number</span><strong>{row.slot_no}</strong></div><div><span>Booked</span><strong>{dateTime(row.booked_at)}</strong></div></div>
      <AmountSummary fee={row.agreed_fee} paid={row.paid_amount} balance={row.balance_due} />
      <div className="record-actions">
        {row.status==='BOOKED' && <Button type="button" variant="secondary" icon="check" busy={busy} onClick={confirm}>Confirm booking</Button>}
        {row.status!=='CANCELLED' && row.balance_due>0 && <Button icon="wallet" onClick={() => setModal({type:'payment',appointment_id})}>Record payment</Button>}
        {canConsult(row) && <Button icon="notes" variant="secondary" onClick={() => setModal({type:'consultation-form',appointment_id})}>Record consultation</Button>}
        {['BOOKED','CONFIRMED'].includes(row.status) && <Button variant="ghost" disabled={row.paid_amount>0} title={row.paid_amount>0 ? 'Resolve recorded payments before cancellation.' : ''} onClick={() => setModal({type:'appointment-cancel',record:row})}>Cancel booking</Button>}
        {['BOOKED','CONFIRMED'].includes(row.status) && Date.parse(row.appointment_end)<=Date.now() && <Button variant="ghost" onClick={() => setModal({type:'appointment-no-show',record:row})}>Mark no-show</Button>}
      </div>
      {['BOOKED','CONFIRMED'].includes(row.status) && !canConsult(row) && <p className="info-note">Consultation entry becomes available after this appointment’s start time.</p>}
      {row.consultation && <div className="detail-section"><div className="subsection-heading"><h3>Consultation</h3>{!row.consultation.prescription && <button className="text-button" onClick={() => setModal({type:'prescription',consultation_id:row.consultation.consultation_id})}>Add prescription</button>}</div><ConsultationContent record={row.consultation} /></div>}
      <div className="detail-section"><h3>Payment history</h3><Table rows={row.payments || []} rowKey="payment_id" caption="Appointment payments" columns={[
        {key:'paid_at',label:'Received',render:payment => dateTime(payment.paid_at)},
        {key:'amount',label:'Amount',render:payment => money(payment.amount)},
        {key:'payment_method',label:'Method',render:payment => payment.payment_method.replaceAll('_',' ')},
        {key:'status',label:'Status',render:payment => <Badge status={payment.status} />},
        {key:'action',label:'',render:payment => payment.status==='COMPLETED' ? <button className="text-button muted" onClick={() => setModal({type:'void-payment',record:payment})}>Void record</button> : '—'}
      ]} empty={<p className="muted small-copy">No payments have been recorded for this appointment.</p>} /></div>
    </>}
  </div><div className="dialog-footer">{row && <Button variant="ghost" onClick={() => {onClose();navigate(`reports?report=patient-history&patient_id=${row.patient_id}`);}}>View patient history</Button>}<Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button></div></Dialog>;
}

export function ActionDialog({ action, record, onClose }) {
  const { done } = useApp();
  const isFee = action==='session-fee';
  const needsReason = ['appointment-cancel','session-cancel'].includes(action);
  const [value,setValue] = useState(isFee ? String(record.consultation_fee) : '');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const definitions = {
    'session-fee': {title:'Change session fee',description:'This fee applies to new bookings. Existing appointments keep their agreed fee.',path:`/sessions/${record.session_id}/fee`,success:'Session fee updated.',button:'Save fee'},
    'session-cancel': {title:'Cancel doctor session',description:'All pending bookings in this session will be cancelled together. Resolve recorded payments before continuing.',path:`/sessions/${record.session_id}/cancel`,success:'Session and pending bookings cancelled.',button:'Cancel session'},
    'session-complete': {title:'Complete doctor session',description:'The session must have ended, and all bookings must be completed, cancelled or marked no-show.',path:`/sessions/${record.session_id}/complete`,success:'Doctor session completed.',button:'Complete session'},
    'appointment-cancel': {title:'Cancel appointment',description:'The booking will remain in history and its slot will become available for another patient.',path:`/appointments/${record.appointment_id}/cancel`,success:'Appointment cancelled.',button:'Cancel appointment'},
    'appointment-no-show': {title:'Mark appointment as no-show',description:'Use this only after the appointment slot has ended and the patient did not attend. The booked fee remains due.',path:`/appointments/${record.appointment_id}/no-show`,success:'Appointment marked as no-show.',button:'Mark no-show'},
    'void-payment': {title:'Void payment record',description:'This corrects the bookkeeping record and restores the amount due. It does not issue a bank refund.',path:`/payments/${record.payment_id}/void`,success:'Payment record voided.',button:'Void record'},
    'delete-specialization': {title:'Delete specialization',description:'Only an unused specialization can be removed. Specializations assigned to doctors are protected.',path:`/specializations/${record.specialization_id}`,method:'DELETE',success:'Specialization deleted.',button:'Delete specialization'}
  };
  const def = definitions[action];
  async function submit(event) {
    event.preventDefault();setBusy(true);setError(null);
    const body = isFee ? {consultation_fee:Number(value)} : needsReason ? {reason:value} : {};
    try {await api(def.path,{method:def.method || 'PATCH',body:def.method==='DELETE' ? undefined : body});done(def.success);}
    catch(failure){setError(failure);}finally{setBusy(false);}
  }
  return <Dialog title={def.title} subtitle={def.description} onClose={onClose} busy={busy}><form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error} />
    {isFee ? <Field label="New consultation fee (LKR)" required><input type="number" min="0" max="99999999.99" step="0.01" required value={value} onChange={event => setValue(event.target.value)} /></Field> : needsReason ? <Field label="Reason for cancellation" required><textarea required rows={3} maxLength={500} value={value} onChange={event => setValue(event.target.value)} /></Field> : <div className="action-summary"><Icon name={action==='void-payment'?'wallet':'notes'} /><strong>{record.patient_name || record.specialization_name || record.doctor_name || (record.amount ? money(record.amount) : 'Confirm this change')}</strong></div>}
  </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Go back</Button><Button type="submit" variant={isFee || action==='session-complete'?'primary':'danger'} busy={busy}>{def.button}</Button></div></form></Dialog>;
}
