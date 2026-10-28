import { useEffect, useState } from 'react';
import { useApi, useAll, useApp } from '../context.jsx';
import { api, dateTime, money, queryString, reference } from '../lib.js';
import { AmountSummary, Badge, Button, Dialog, Empty, ErrorNotice, Field, Loading, PageHeader, Pagination, Person, Table } from '../components/ui.jsx';

export default function Payments() {
  const { setModal } = useApp();
  const [status,setStatus] = useState('');
  const [offset,setOffset] = useState(0);
  const result = useApi(`/payments${queryString({status,limit:10,offset})}`);
  return <><PageHeader title="Payments" description="Track received payments, outstanding fees and bookkeeping corrections."><Button icon="plus" onClick={() => setModal({type:'payment'})}>Record payment</Button></PageHeader>
    <ErrorNotice error={result.error} retry={result.reload} />
    <section className="card"><div className="list-toolbar"><div className="section-title"><h2>Payment records</h2></div><select aria-label="Filter payment status" value={status} onChange={event => {setStatus(event.target.value);setOffset(0);}}><option value="">All statuses</option><option value="COMPLETED">Completed</option><option value="VOIDED">Voided</option></select></div>
    <Table rows={result.data?.data || []} rowKey="payment_id" loading={result.loading} caption="Payments" columns={[
      {key:'patient_name',label:'Patient',render:row => <Person name={row.patient_name} secondary={`${reference('PAY',row.payment_id)} · ${reference('APT',row.appointment_id)}`} id={row.appointment_id} />},
      {key:'paid_at',label:'Received',render:row => dateTime(row.paid_at)},
      {key:'amount',label:'Amount',render:row => <strong>{money(row.amount)}</strong>},
      {key:'payment_method',label:'Method',render:row => row.payment_method.replaceAll('_',' ')},
      {key:'reference_no',label:'Reference',render:row => <span className="reference-cell">{row.reference_no || '—'}</span>},
      {key:'status',label:'Status',render:row => <Badge status={row.status} />},
      {key:'actions',label:'Actions',className:'actions-cell',render:row => <div className="row-actions"><button className="text-button" onClick={() => setModal({type:'appointment',appointment_id:row.appointment_id})}>Appointment</button>{row.status==='COMPLETED' && <button className="text-button muted" onClick={() => setModal({type:'void-payment',record:row})}>Void record</button>}</div>}
    ]} empty={<Empty title="No payment records found" description="Received payments will appear here." icon="wallet" />} /><Pagination pagination={result.data?.pagination} offset={offset} onChange={setOffset} /></section></>;
}

export function PaymentDialog({ appointment_id = '', onClose }) {
  const { done } = useApp();
  const appointments = useAll('/appointments');
  const eligible = appointments.data.filter(row => row.status!=='CANCELLED' && row.balance_due>0);
  const [appointment,setAppointment] = useState(String(appointment_id));
  const [amount,setAmount] = useState('');
  const [method,setMethod] = useState('CASH');
  const [referenceNo,setReferenceNo] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const selected = eligible.find(row => row.appointment_id === Number(appointment));
  useEffect(() => {setAmount(selected ? String(selected.balance_due) : '');}, [appointment,selected?.balance_due]);
  async function submit(event) {
    event.preventDefault();setBusy(true);setError(null);
    try {await api('/payments',{method:'POST',body:{appointment_id:Number(appointment),amount:Number(amount),payment_method:method,reference_no:referenceNo || null}});done('Payment recorded.');}
    catch(failure){setError(failure);appointments.reload();}finally{setBusy(false);}
  }
  return <Dialog title="Record payment" subtitle="Record a payment received for an appointment. All amounts are in LKR." onClose={onClose} busy={busy}><form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error || appointments.error} retry={appointments.error ? appointments.reload : null} />
    {appointments.loading ? <Loading label="Loading outstanding appointments…" /> : !eligible.length ? <Empty title="No outstanding appointments" description="All appointments have been settled or cancelled." icon="wallet" /> : <>
      <Field label="Appointment" required><select required value={appointment} onChange={event => setAppointment(event.target.value)}><option value="">Select an appointment</option>{eligible.map(row => <option key={row.appointment_id} value={row.appointment_id}>{reference('APT',row.appointment_id)} · {row.patient_name} · {dateTime(row.appointment_start)}</option>)}</select></Field>
      {selected && <AmountSummary fee={selected.agreed_fee} paid={selected.paid_amount} balance={selected.balance_due} />}
      <div className="form-grid form-section"><Field label="Amount received (LKR)" required><input type="number" min="0.01" max={selected?.balance_due || 99999999.99} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></Field>
      <Field label="Payment method" required><select value={method} onChange={event => setMethod(event.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option></select></Field>
      <Field label="Payment reference" className="span-two" hint="Optional receipt or bank reference."><input maxLength={100} value={referenceNo} onChange={event => setReferenceNo(event.target.value)} /></Field></div></>}
    </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={!selected || appointments.loading || appointments.error}>Record payment</Button></div></form></Dialog>;
}
