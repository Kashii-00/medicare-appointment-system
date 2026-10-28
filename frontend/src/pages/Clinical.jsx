import { useState } from 'react';
import { useApi, useAll, useApp } from '../context.jsx';
import { api, canConsult, dateOnly, dateTime, fullName, localId, queryString, reference, today } from '../lib.js';
import { Button, Dialog, Empty, ErrorNotice, Field, Icon, Loading, PageHeader, Pagination, Person, Table } from '../components/ui.jsx';

export default function Clinical() {
  const { setModal } = useApp();
  const patients = useAll('/patients');
  const [patient,setPatient] = useState('');
  const [offset,setOffset] = useState(0);
  const result = useApi(`/consultations${queryString({patient_id:patient,limit:10,offset})}`);
  return <><PageHeader title="Consultations" description="Keep clinical notes and prescriptions connected to each patient’s visit."><Button icon="plus" onClick={() => setModal({type:'consultation-form'})}>Record consultation</Button></PageHeader>
    <ErrorNotice error={result.error || patients.error} retry={() => {result.reload();patients.reload();}} />
    <section className="card"><div className="list-toolbar"><div className="section-title"><span className="section-icon"><Icon name="notes" /></span><h2>Consultation history</h2></div><select aria-label="Filter consultation patient" value={patient} onChange={event => {setPatient(event.target.value);setOffset(0);}}><option value="">All patients</option>{patients.data.map(row => <option key={row.patient_id} value={row.patient_id}>{fullName(row)}</option>)}</select></div>
    <Table rows={result.data?.data || []} rowKey="consultation_id" loading={result.loading} caption="Consultation history" columns={[
      {key:'patient_name',label:'Patient',render:row => <Person name={row.patient_name} secondary={reference('CON',row.consultation_id)} id={row.patient_id} />},
      {key:'doctor_name',label:'Doctor',render:row => <><strong>Dr. {row.doctor_name}</strong><span className="cell-secondary">{row.clinic_name}</span></>},
      {key:'consulted_at',label:'Consulted',render:row => dateTime(row.consulted_at)},
      {key:'diagnosis',label:'Diagnosis',render:row => <span className="wrap-cell line-clamp" title={row.diagnosis}>{row.diagnosis}</span>},
      {key:'action',label:'',render:row => <button className="text-button" onClick={() => setModal({type:'consultation',consultation_id:row.consultation_id})}>View record <Icon name="chevron" size={15} /></button>}
    ]} empty={<Empty title="No consultations found" description="Completed consultation records will appear here." icon="notes" />} />
    <Pagination pagination={result.data?.pagination} offset={offset} onChange={setOffset} /></section></>;
}

export function ConsultationContent({ record }) {
  return <div className="clinical-record"><dl><div><dt>Diagnosis</dt><dd>{record.diagnosis}</dd></div>{record.symptoms && <div><dt>Symptoms</dt><dd>{record.symptoms}</dd></div>}{record.clinical_notes && <div><dt>Clinical notes</dt><dd className="preserve-lines">{record.clinical_notes}</dd></div>}{record.follow_up_date && <div><dt>Follow-up date</dt><dd>{dateOnly(record.follow_up_date)}</dd></div>}</dl>
    {record.prescription && <div className="prescription-record"><div className="subsection-heading"><h3>Prescription {reference('RX',record.prescription.prescription_id)}</h3><span>{dateTime(record.prescription.issued_at)}</span></div>
      {record.prescription.notes && <p className="muted small-copy">{record.prescription.notes}</p>}
      <div className="medicine-records">{record.prescription.items.map(item => <div className="medicine-record" key={item.line_no}><span className="medicine-line">{item.line_no}</span><div><strong>{item.medicine_name}</strong><p>{item.strength} · {item.dosage_form}</p><span>{item.dosage} · {item.frequency} · {item.duration_days} days</span>{item.instructions && <small>{item.instructions}</small>}</div></div>)}</div></div>}
  </div>;
}

export function ConsultationDialog({ consultation_id, onClose }) {
  const { setModal, navigate } = useApp();
  const result = useApi(`/consultations/${consultation_id}`);
  const row = result.data?.data;
  return <Dialog title={`Consultation ${reference('CON',consultation_id)}`} subtitle="Patient visit notes and prescribed medicines." onClose={onClose} wide><div className="dialog-body"><ErrorNotice error={result.error} retry={result.reload} />
    {result.loading ? <Loading /> : row && <><div className="record-banner"><Person name={row.patient_name} secondary={`Dr. ${row.doctor_name}`} id={row.patient_id} /><span className="type-chip">Completed visit</span></div><div className="detail-grid"><div><span>Facility</span><strong>{row.clinic_name}</strong></div><div><span>Consulted</span><strong>{dateTime(row.consulted_at)}</strong></div></div><ConsultationContent record={row} />
      {!row.prescription && <Empty title="No prescription recorded" description="Add medicine instructions if a prescription was issued for this visit." icon="pill" action={<Button variant="secondary" onClick={() => setModal({type:'prescription',consultation_id})}>Add prescription</Button>} />}</>}
    </div><div className="dialog-footer">{row && <Button variant="ghost" onClick={() => {onClose();navigate(`reports?report=patient-history&patient_id=${row.patient_id}`);}}>View patient history</Button>}<Button variant="secondary" onClick={onClose}>Close</Button></div></Dialog>;
}

export function ConsultationForm({ appointment_id = '', onClose }) {
  const { done, refresh, setModal, toast, navigate } = useApp();
  const appointments = useAll('/appointments');
  const available = appointments.data.filter(canConsult);
  const [values,setValues] = useState({appointment_id:String(appointment_id),symptoms:'',diagnosis:'',clinical_notes:'',follow_up_date:''});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const update = (key,value) => setValues(previous => ({...previous,[key]:value}));
  async function submit(event) {
    event.preventDefault();const prescribe = event.nativeEvent.submitter?.value === 'prescribe';setBusy(true);setError(null);
    try {
      const result = await api('/consultations',{method:'POST',body:{...values,appointment_id:Number(values.appointment_id),follow_up_date:values.follow_up_date || null}});
      if (prescribe) {refresh();toast('Consultation recorded.');setModal({type:'prescription',consultation_id:result.data.consultation_id});}
      else done('Consultation recorded and appointment completed.');
    } catch(failure){setError(failure);}finally{setBusy(false);}
  }
  return <Dialog title="Record consultation" subtitle="Saving this record also completes the appointment." onClose={onClose} wide busy={busy}><form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error || appointments.error} retry={appointments.error ? appointments.reload : null} />
    {appointments.loading ? <Loading label="Finding eligible appointments…" /> : !available.length ? <Empty title="No appointments are ready for consultation" description="A pending appointment becomes eligible after its start time. Completed and no-show appointments cannot be consulted again." icon="clock" action={<Button type="button" variant="secondary" onClick={() => {onClose();navigate('appointments');}}>View appointments</Button>} /> : <>
      <Field label="Appointment" required><select required value={values.appointment_id} onChange={event => update('appointment_id',event.target.value)}><option value="">Select an appointment</option>{available.map(row => <option key={row.appointment_id} value={row.appointment_id}>{reference('APT',row.appointment_id)} · {row.patient_name} · Dr. {row.doctor_name} · {dateTime(row.appointment_start)}</option>)}</select></Field>
      <div className="form-grid form-section"><Field label="Symptoms" className="span-two"><textarea rows={2} maxLength={2000} value={values.symptoms} onChange={event => update('symptoms',event.target.value)} /></Field>
      <Field label="Diagnosis" required className="span-two"><textarea rows={2} required maxLength={2000} value={values.diagnosis} onChange={event => update('diagnosis',event.target.value)} /></Field>
      <Field label="Clinical notes" className="span-two"><textarea rows={4} maxLength={20000} value={values.clinical_notes} onChange={event => update('clinical_notes',event.target.value)} /></Field>
      <Field label="Follow-up date"><input type="date" min={today()} value={values.follow_up_date} onChange={event => update('follow_up_date',event.target.value)} /></Field></div></>}
    </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" name="action" value="save" busy={busy} disabled={!values.appointment_id || !available.length}>Save consultation</Button><Button type="submit" name="action" value="prescribe" variant="secondary" disabled={busy || !values.appointment_id || !available.length}>Save & prescribe</Button></div></form></Dialog>;
}

export function PrescriptionDialog({ consultation_id, onClose }) {
  const { done } = useApp();
  const medicines = useAll('/medicines?active_flag=Y');
  const consultation = useApi(`/consultations/${consultation_id}`);
  const newItem = () => ({key:localId(),medicine_id:'',dosage:'',frequency:'',duration_days:'',instructions:''});
  const [items,setItems] = useState(() => [newItem()]);
  const [notes,setNotes] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(null);
  const change = (index,key,value) => setItems(previous => previous.map((item,i) => i===index ? {...item,[key]:value} : item));
  async function submit(event) {
    event.preventDefault();setBusy(true);setError(null);
    try {await api('/prescriptions',{method:'POST',body:{consultation_id,notes,items:items.map(({key,...item}) => ({...item,medicine_id:Number(item.medicine_id),duration_days:Number(item.duration_days)}))}});done('Prescription saved.');}
    catch(failure){setError(failure);}finally{setBusy(false);}
  }
  return <Dialog title="Add prescription" subtitle={consultation.data ? `For ${consultation.data.data.patient_name} · ${reference('CON',consultation_id)}` : 'Record medicines and the doctor’s instructions.'} onClose={onClose} busy={busy} wide><form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error || medicines.error || consultation.error} />
    {medicines.loading || consultation.loading ? <Loading /> : consultation.data?.data.prescription ? <p className="info-note">This consultation already has a prescription.</p> : !medicines.data.length ? <Empty title="Add medicines to the catalogue first" description="At least one active medicine is needed to create a prescription." icon="pill" /> : <>
      <div className="prescription-lines">{items.map((item,index) => <section className="prescription-line" key={item.key}><div className="subsection-heading"><h3>Medicine {index+1}</h3>{items.length>1 && <button type="button" className="text-button muted" onClick={() => setItems(previous => previous.filter((_,i) => i!==index))}>Remove</button>}</div>
        <div className="form-grid"><Field label="Medicine" required className="span-two"><select required value={item.medicine_id} onChange={event => change(index,'medicine_id',event.target.value)}><option value="">Select a medicine</option>{medicines.data.map(row => <option key={row.medicine_id} value={row.medicine_id}>{row.medicine_name} · {row.strength} · {row.dosage_form}</option>)}</select></Field>
        <Field label="Dosage" required><input required maxLength={100} placeholder="Enter prescribed dosage" value={item.dosage} onChange={event => change(index,'dosage',event.target.value)} /></Field>
        <Field label="Frequency" required><input required maxLength={100} placeholder="Enter prescribed frequency" value={item.frequency} onChange={event => change(index,'frequency',event.target.value)} /></Field>
        <Field label="Duration (days)" required><input type="number" min="1" max="365" step="1" required value={item.duration_days} onChange={event => change(index,'duration_days',event.target.value)} /></Field>
        <Field label="Instructions"><input maxLength={1000} value={item.instructions} onChange={event => change(index,'instructions',event.target.value)} /></Field></div></section>)}</div>
      <Button type="button" variant="secondary" icon="plus" disabled={items.length>=999} onClick={() => setItems(previous => [...previous,newItem()])}>Add another medicine</Button>
      <Field label="Prescription notes" className="form-section"><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field></>}
    </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={medicines.loading || consultation.loading || medicines.error || consultation.error || !medicines.data.length || Boolean(consultation.data?.data.prescription)}>Save prescription</Button></div></form></Dialog>;
}
