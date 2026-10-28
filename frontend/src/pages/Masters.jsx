import { useState } from 'react';
import { useApi, useAll, useApp } from '../context.jsx';
import { api, dateOnly, fullName, queryString, reference } from '../lib.js';
import { Avatar, Badge, Button, Dialog, Empty, ErrorNotice, Field, Icon, Loading, PageHeader, Pagination, Person, Table } from '../components/ui.jsx';

const field = (key, label, type = 'text', required = false, max = 100, options) => ({ key, label, type, required, max, options });
export const masterDefinitions = {
  patients: { title: 'Patients', singular: 'patient', id: 'patient_id', description: 'Patient details and the care history behind every appointment.', icon: 'users', fields: [
    field('first_name','First name','text',true,80),field('last_name','Last name','text',true,80),
    field('date_of_birth','Date of birth','date',true),field('gender','Gender','select',false,12,['UNSPECIFIED','MALE','FEMALE','OTHER']),
    field('phone','Phone number','tel',true,30),field('email','Email address','email',false,254),field('address','Address','textarea',false,500)
  ] },
  doctors: { title: 'Doctors', singular: 'doctor', id: 'doctor_id', description: 'Manage healthcare professionals and their areas of expertise.', icon: 'doctor', fields: [
    field('registration_no','Registration number','text',true,30),field('first_name','First name','text',true,80),
    field('last_name','Last name','text',true,80),field('phone','Phone number','tel',true,30),field('email','Email address','email',false,254)
  ] },
  clinics: { title: 'Clinics & hospitals', singular: 'facility', id: 'clinic_id', description: 'The places where your patients receive care.', icon: 'clinic', fields: [
    field('clinic_name','Facility name','text',true,150),field('facility_type','Facility type','select',true,10,['CLINIC','HOSPITAL']),
    field('city','City','text',true,80),field('phone','Phone number','tel',true,30),field('address','Address','textarea',true,500)
  ] },
  medicines: { title: 'Medicines', singular: 'medicine', id: 'medicine_id', description: 'Maintain the medicine catalogue used in prescriptions.', icon: 'pill', fields: [
    field('medicine_name','Medicine name','text',true,150),field('strength','Strength','text',true,80),field('dosage_form','Dosage form','text',true,50)
  ] },
  specializations: { title: 'Specializations', singular: 'specialization', id: 'specialization_id', description: 'Organize the areas of care offered by your doctors.', icon: 'layers', fields: [
    field('specialization_name','Specialization name','text',true,100),field('description','Description','textarea',false,500)
  ] }
};

export function MasterPage({ resource }) {
  const def = masterDefinitions[resource];
  const { setModal, navigate, done, toast } = useApp();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [offset, setOffset] = useState(0);
  const [pendingId, setPendingId] = useState(null);
  const records = useApi(`/${resource}${queryString({ q: search, active_flag: active, limit: 10, offset })}`);
  const rows = records.data?.data || [];
  async function toggle(row) {
    setPendingId(row[def.id]);
    try { await api(`/${resource}/${row[def.id]}`, { method: 'PATCH', body: { active_flag: row.active_flag === 'Y' ? 'N' : 'Y' } }); done(`${def.singular[0].toUpperCase() + def.singular.slice(1)} updated.`); }
    catch (error) { toast(error.message, 'error'); }
    finally { setPendingId(null); }
  }
  const columns = resource === 'patients' ? [
    { key: 'name', label: 'Patient', render: row => <Person name={fullName(row)} secondary={reference('PAT', row.patient_id)} id={row.patient_id} /> },
    { key: 'phone', label: 'Contact', render: row => <><strong>{row.phone}</strong><span className="cell-secondary">{row.email || 'No email provided'}</span></> },
    { key: 'date_of_birth', label: 'Date of birth', render: row => dateOnly(row.date_of_birth) },
    { key: 'gender', label: 'Gender', render: row => row.gender === 'UNSPECIFIED' ? 'Not specified' : row.gender[0] + row.gender.slice(1).toLowerCase() }
  ] : resource === 'doctors' ? [
    { key: 'name', label: 'Doctor', render: row => <Person name={`Dr. ${fullName(row)}`} secondary={row.registration_no} id={row.doctor_id} /> },
    { key: 'specializations', label: 'Specializations', render: row => <span className="wrap-cell">{row.specializations || 'Not assigned'}</span> },
    { key: 'phone', label: 'Contact', render: row => <>{row.phone}<span className="cell-secondary">{row.email || 'No email provided'}</span></> }
  ] : resource === 'clinics' ? [
    { key: 'clinic_name', label: 'Facility', render: row => <Person name={row.clinic_name} secondary={reference('FAC',row.clinic_id)} icon="clinic" /> },
    { key: 'facility_type', label: 'Type', render: row => <span className="type-chip">{row.facility_type === 'HOSPITAL' ? 'Hospital' : 'Clinic'}</span> },
    { key: 'city', label: 'City' }, { key: 'phone', label: 'Contact' }
  ] : resource === 'medicines' ? [
    { key: 'medicine_name', label: 'Medicine', render: row => <Person name={row.medicine_name} secondary={reference('MED',row.medicine_id)} icon="pill" /> },
    { key: 'strength', label: 'Strength' }, { key: 'dosage_form', label: 'Dosage form' }
  ] : [
    { key: 'specialization_name', label: 'Specialization', render: row => <Person name={row.specialization_name} secondary={reference('SPE',row.specialization_id)} icon="layers" /> },
    { key: 'description', label: 'Description', render: row => <span className="wrap-cell">{row.description || '—'}</span> }
  ];
  if (resource !== 'specializations') columns.push({ key: 'active_flag', label: 'Status', render: row => <Badge status={row.active_flag} /> });
  columns.push({ key: 'actions', label: 'Actions', className: 'actions-cell', render: row => <div className="row-actions">
    <button className="text-button" onClick={() => setModal({ type: 'master', resource, record: row })}>Edit</button>
    {resource === 'patients' && <button className="text-button" onClick={() => navigate(`reports?report=patient-history&patient_id=${row.patient_id}`)}>History</button>}
    {resource === 'doctors' && <button className="text-button" onClick={() => navigate(`sessions?doctor_id=${row.doctor_id}`)}>Sessions</button>}
    {resource === 'specializations' ? <button className="text-button muted" onClick={() => setModal({ type: 'delete-specialization', record: row })}>Delete</button> :
      <button className="text-button muted" disabled={pendingId === row[def.id]} onClick={() => toggle(row)}>{row.active_flag === 'Y' ? 'Deactivate' : 'Activate'}</button>}
  </div> });
  return <>
    <PageHeader title={def.title} description={def.description}><Button icon="plus" onClick={() => setModal({ type: 'master', resource })}>Add {def.singular}</Button></PageHeader>
    <ErrorNotice error={records.error} retry={records.reload} />
    <section className="card"><div className="list-toolbar"><div className="section-title"><span className="section-icon"><Icon name={def.icon} /></span><h2>All {resource === 'clinics' ? 'facilities' : resource}</h2></div>
      <div className="toolbar-filters"><label className="search-input"><Icon name="search" size={17} /><input aria-label={`Search ${resource}`} placeholder={`Search ${resource === 'clinics' ? 'facilities' : resource}…`} value={search} onChange={event => {setSearch(event.target.value);setOffset(0);}} /></label>
        {resource !== 'specializations' && <select aria-label="Filter by activity" value={active} onChange={event => {setActive(event.target.value);setOffset(0);}}><option value="">All statuses</option><option value="Y">Active</option><option value="N">Inactive</option></select>}</div></div>
      <Table columns={columns} rows={rows} rowKey={def.id} loading={records.loading} caption={def.title}
        empty={<Empty icon={def.icon} title={`No ${resource === 'clinics' ? 'facilities' : resource} found`} action={<Button variant="secondary" onClick={() => setModal({ type: 'master', resource })}>Add {def.singular}</Button>} />} />
      <Pagination pagination={records.data?.pagination} offset={offset} onChange={setOffset} />
    </section>
  </>;
}

export function MasterDialog({ resource, record, onClose }) {
  const def = masterDefinitions[resource];
  const { done } = useApp();
  const [values, setValues] = useState(() => Object.fromEntries([
    ...def.fields.map(item => [item.key, record?.[item.key] ?? (item.key === 'gender' ? 'UNSPECIFIED' : item.key === 'facility_type' ? 'CLINIC' : '')]),
    ['specialization_ids', record?.specialization_ids || []]
  ]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const specs = useAll(resource === 'doctors' ? '/specializations' : null);
  function update(key, value) { setValues(previous => ({ ...previous, [key]: value })); }
  async function submit(event) {
    event.preventDefault(); setError(null);
    if (resource === 'doctors' && !values.specialization_ids.length) { setError('Select at least one specialization.'); return; }
    const body = Object.fromEntries(def.fields.map(item => [item.key, values[item.key] === '' && !item.required ? null : values[item.key]]));
    if (resource === 'doctors') body.specialization_ids = values.specialization_ids;
    setBusy(true);
    try {
      await api(`/${resource}${record ? `/${record[def.id]}` : ''}`, { method: record ? 'PUT' : 'POST', body });
      done(`${def.singular[0].toUpperCase() + def.singular.slice(1)} ${record ? 'updated' : 'added'}.`);
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <Dialog title={`${record ? 'Edit' : 'Add'} ${def.singular}`} subtitle="Keep details accurate so your team can find the right record." onClose={onClose} busy={busy}>
    <form onSubmit={submit}><div className="dialog-body"><ErrorNotice error={error || specs.error} retry={specs.error ? specs.reload : null} />
      <div className="form-grid">{def.fields.map(item => <Field key={item.key} label={item.label} required={item.required} className={item.type === 'textarea' ? 'span-two' : ''}>
        {item.type === 'textarea' ? <textarea rows={3} value={values[item.key]} maxLength={item.max} required={item.required} onChange={event => update(item.key,event.target.value)} /> : item.type === 'select' ?
          <select value={values[item.key]} required={item.required} onChange={event => update(item.key,event.target.value)}>{item.options.map(value => <option key={value} value={value}>{value[0]+value.slice(1).toLowerCase().replaceAll('_',' ')}</option>)}</select> :
          <input type={item.type} value={values[item.key]} maxLength={item.max} required={item.required} autoComplete="off" onChange={event => update(item.key,event.target.value)} />}
      </Field>)}</div>
      {resource === 'doctors' && <fieldset className="choice-fieldset"><legend>Specializations <span className="required">*</span></legend>{specs.loading ? <Loading label="Loading specializations…" /> : specs.data.length ? <div className="checkbox-grid">{specs.data.map(item => <label key={item.specialization_id} className="checkbox-option"><input type="checkbox" checked={values.specialization_ids.includes(item.specialization_id)} onChange={event => update('specialization_ids',event.target.checked ? [...values.specialization_ids,item.specialization_id] : values.specialization_ids.filter(id => id !== item.specialization_id))} />{item.specialization_name}</label>)}</div> : <p className="muted">Add a specialization before registering a doctor.</p>}</fieldset>}
    </div><div className="dialog-footer"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} disabled={resource === 'doctors' && (specs.loading || specs.error || !specs.data.length)}>{record ? 'Save changes' : `Add ${def.singular}`}</Button></div></form>
  </Dialog>;
}
