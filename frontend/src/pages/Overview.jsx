import { useApi, useAll, useApp } from '../context.jsx';
import { addDays, dateTime, money, number, reference, today } from '../lib.js';
import { Avatar, Badge, Button, Empty, ErrorNotice, Icon, Loading, PageHeader, Person, Table } from '../components/ui.jsx';

export default function Overview() {
  const { setModal, navigate } = useApp();
  const summary = useApi('/dashboard');
  const sessions = useApi('/sessions?upcoming=true&limit=4');
  const appointments = useAll(`/appointments?from=${today()}&to=${addDays(today(),7)}`);
  const stats = summary.data?.data;
  const upcoming = appointments.data.filter(row => ['BOOKED','CONFIRMED'].includes(row.status) && Date.parse(row.appointment_start) > Date.now()).sort((a,b) => Date.parse(a.appointment_start)-Date.parse(b.appointment_start)).slice(0,6);
  const cards = [
    { label: 'Pending appointments', value: stats?.pending_appointments, icon:'calendar', className:'mint', hint:'Booked & confirmed' },
    { label: 'Registered patients', value: stats?.active_patients, icon:'users', className:'blue', hint:'Active patient records' },
    { label: 'Collected today', value: stats?.collected_today_lkr, icon:'wallet', className:'peach', currency:true, hint:'Completed payments · LKR' },
    { label: 'Outstanding balance', value: stats?.outstanding_lkr, icon:'chart', className:'lavender', currency:true, hint:'Across unpaid appointments' }
  ];
  return <>
    <PageHeader eyebrow="YOUR CLINIC, CONNECTED" title="Clinic overview" description="A clear view of appointments, people and payments."><Button icon="plus" onClick={() => setModal({type:'booking'})}>Book appointment</Button></PageHeader>
    <ErrorNotice error={summary.error} retry={summary.reload} />
    <div className="stat-grid">{cards.map(card => <section key={card.label} className={`stat-card stat-${card.className}`}><div className="stat-top"><span>{card.label}</span><span className="stat-icon"><Icon name={card.icon} /></span></div><strong className={card.currency ? 'currency-stat' : ''}>{summary.loading ? <span className="skeleton-number" /> : stats ? card.currency ? money(card.value) : number(card.value) : '—'}</strong><small>{card.hint}</small></section>)}</div>
    <div className="overview-grid"><section className="card"><div className="section-header"><div><span className="eyebrow">COMING UP</span><h2>Upcoming sessions</h2></div><button className="text-button" onClick={() => navigate('sessions')}>View all <Icon name="arrow" size={16} /></button></div>
      <ErrorNotice error={sessions.error} retry={sessions.reload} />
      {sessions.loading ? <Loading /> : sessions.data?.data.length ? <div className="session-list">{sessions.data.data.map(session => <button className="session-summary" key={session.session_id} onClick={() => setModal({type:'slots',session_id:session.session_id})}><Avatar name={session.doctor_name} id={session.doctor_id} /><div className="session-summary-main"><strong>Dr. {session.doctor_name}</strong><span>{session.clinic_name}</span><small><Icon name="clock" size={13} />{dateTime(session.start_time)}</small></div><div className="session-summary-count"><strong>{Math.max(0,session.capacity-session.booked_slots)}</strong><span>unbooked slots</span></div><Icon name="chevron" size={17} /></button>)}</div> : <Empty title="No upcoming sessions" description="Create a doctor session to open new appointment slots." icon="calendar" action={<Button variant="secondary" onClick={() => navigate('sessions')}>Manage sessions</Button>} />}
    </section><section className="care-card"><div className="care-illustration" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="care-cross"><span /><span /></div><span className="floating-heart"><Icon name="heart" size={22} /></span><span className="floating-check"><Icon name="check" size={21} /></span></div><span className="eyebrow">A LITTLE LESS ADMIN</span><h2>More time for<br />the people you care for.</h2><p>Keep patient records, appointments and payments together in one workspace.</p><Button variant="light" icon="users" onClick={() => navigate('patients')}>View patients</Button><div className="care-footnote"><span className="live-dot" />{stats ? `${number(stats.active_doctors)} active doctors · ${number(stats.active_clinics)} facilities` : 'Your team, in one place'}</div></section></div>
    <section className="card"><div className="section-header"><div><span className="eyebrow">THE NEXT SEVEN DAYS</span><h2>Upcoming appointments</h2></div><button className="text-button" onClick={() => navigate('appointments')}>View appointments <Icon name="arrow" size={16} /></button></div>
      <ErrorNotice error={appointments.error} retry={appointments.reload} />
      <Table rows={upcoming} rowKey="appointment_id" loading={appointments.loading} caption="Upcoming appointments" columns={[
        {key:'patient_name',label:'Patient',render:row => <Person name={row.patient_name} secondary={reference('APT',row.appointment_id)} id={row.patient_id} />},
        {key:'doctor_name',label:'Doctor',render:row => <><strong>Dr. {row.doctor_name}</strong><span className="cell-secondary">{row.clinic_name}</span></>},
        {key:'appointment_start',label:'Date & time',render:row => dateTime(row.appointment_start)},
        {key:'status',label:'Status',render:row => <Badge status={row.status} />},
        {key:'balance_due',label:'Balance',render:row => <strong className={row.balance_due>0?'amount-due':''}>{money(row.balance_due)}</strong>},
        {key:'actions',label:'',render:row => <button className="text-button" onClick={() => setModal({type:'appointment',appointment_id:row.appointment_id})}>View <Icon name="chevron" size={15} /></button>}
      ]} empty={<Empty title="No appointments in the next seven days" description="Book an appointment or check a different date range in Appointments." icon="calendar" />} />
    </section>
  </>;
}
