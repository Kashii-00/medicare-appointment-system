import { useEffect, useState } from 'react';
import { useApi, useApp } from './context.jsx';
import { Button, Icon } from './components/ui.jsx';
import Overview from './pages/Overview.jsx';
import { MasterDialog, MasterPage } from './pages/Masters.jsx';
import Sessions, { BookingDialog, SessionDialog, SlotsDialog } from './pages/Sessions.jsx';
import Appointments, { ActionDialog, AppointmentDialog } from './pages/Appointments.jsx';
import Clinical, { ConsultationDialog, ConsultationForm, PrescriptionDialog } from './pages/Clinical.jsx';
import Payments, { PaymentDialog } from './pages/Payments.jsx';
import Reports from './pages/Reports.jsx';

const navigation = [
  {id:'overview',label:'Overview',icon:'grid'},
  {id:'appointments',label:'Appointments',icon:'calendar'},
  {id:'patients',label:'Patients',icon:'users'},
  {id:'doctors',label:'Doctors',icon:'doctor'},
  {id:'sessions',label:'Doctor sessions',icon:'clock'},
  {id:'clinics',label:'Clinics & hospitals',icon:'clinic'},
  {id:'consultations',label:'Consultations',icon:'notes'},
  {id:'payments',label:'Payments',icon:'wallet'},
  {id:'reports',label:'Business reports',icon:'chart'},
  {id:'medicines',label:'Medicines',icon:'pill',catalogue:true},
  {id:'specializations',label:'Specializations',icon:'layers',catalogue:true}
];

function ModalHost() {
  const { modal, setModal } = useApp();
  if (!modal) return null;
  const props = {...modal,onClose:() => setModal(null)};
  const key = `${modal.type}-${modal.record?.appointment_id || modal.appointment_id || modal.consultation_id || modal.resource || ''}`;
  if (modal.type==='master') return <MasterDialog key={key} {...props} />;
  if (modal.type==='session') return <SessionDialog key={key} {...props} />;
  if (modal.type==='slots') return <SlotsDialog key={key} {...props} />;
  if (modal.type==='booking') return <BookingDialog key={key} {...props} />;
  if (modal.type==='appointment') return <AppointmentDialog key={key} {...props} />;
  if (modal.type==='consultation') return <ConsultationDialog key={key} {...props} />;
  if (modal.type==='consultation-form') return <ConsultationForm key={key} {...props} />;
  if (modal.type==='prescription') return <PrescriptionDialog key={key} {...props} />;
  if (modal.type==='payment') return <PaymentDialog key={key} {...props} />;
  return <ActionDialog key={key} action={modal.type} {...props} />;
}

export default function App() {
  const { page,params,navigate,refresh,toasts,setToasts } = useApp();
  const [mobile,setMobile] = useState(false);
  const [clock,setClock] = useState(new Date());
  const health = useApi('/health');
  useEffect(() => {const timer=setInterval(() => {setClock(new Date());health.reload();},30000);return () => clearInterval(timer);},[health.reload]);
  useEffect(() => {setMobile(false);window.scrollTo({top:0});},[page]);
  const current = navigation.find(row => row.id===page);
  let content;
  if (page==='overview') content=<Overview />;
  else if (['patients','doctors','clinics','medicines','specializations'].includes(page)) content=<MasterPage resource={page} />;
  else if (page==='sessions') content=<Sessions />;
  else if (page==='appointments') content=<Appointments />;
  else if (page==='consultations') content=<Clinical />;
  else if (page==='payments') content=<Payments />;
  else if (page==='reports') content=<Reports />;
  else content=<div className="not-found"><h1>Page not found</h1><Button onClick={() => navigate('overview')}>Return to overview</Button></div>;
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={event => {event.preventDefault();document.getElementById('main-content')?.focus();}}>Skip to content</a>
    {mobile && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <aside className={`sidebar ${mobile?'sidebar-open':''}`}><a className="brand" href="#/overview"><span className="brand-mark"><span /><span /></span><span>Medi<span>Care</span><small>CLINIC WORKSPACE</small></span></a>
      <div className="workspace-label"><span className="workspace-symbol"><Icon name="clinic" size={18} /></span><div><strong>Clinic workspace</strong><small>Sri Lanka</small></div></div>
      <nav aria-label="Main navigation"><span className="nav-group-label">WORKSPACE</span>{navigation.filter(row => !row.catalogue).map(row => <a key={row.id} href={`#/${row.id}`} className={`nav-item ${page===row.id?'active':''}`} aria-current={page===row.id?'page':undefined}><Icon name={row.icon} size={19} /><span>{row.label}</span>{page===row.id && <span className="nav-active-dot" />}</a>)}
        <span className="nav-group-label catalogue-label">CATALOGUE</span>{navigation.filter(row => row.catalogue).map(row => <a key={row.id} href={`#/${row.id}`} className={`nav-item ${page===row.id?'active':''}`} aria-current={page===row.id?'page':undefined}><Icon name={row.icon} size={19} /><span>{row.label}</span></a>)}</nav>
      <div className="sidebar-footer"><div className="sidebar-avatar"><Icon name="heart" size={18} /></div><div><strong>Thoughtful care.</strong><small>One connected workspace.</small></div></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobile(true)}><Icon name="menu" /></button><span>Workspace</span><Icon name="chevron" size={12} /><strong>{current?.label || 'Page'}</strong></div><div className="topbar-right"><span className={`connection-pill ${health.error?'offline':''}`} title={health.error?.message || 'Backend connection'}><span />{health.error?'Disconnected':health.data?'Connected':'Connecting'}</span><span className="topbar-date"><Icon name="calendar" size={15} />{new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Colombo',day:'2-digit',month:'short',year:'numeric'}).format(clock)}</span><button className="icon-button" aria-label="Refresh records" title="Refresh records" onClick={refresh}><Icon name="refresh" size={18} /></button></div></header>
      <main id="main-content" tabIndex={-1} className="page-content" key={`${page}-${params.toString()}`}>{content}<footer className="page-footer"><span>MediCare <span>·</span> Clinic workspace</span><span>All appointment times are shown in Sri Lanka time.</span></footer></main>
    </div>
    <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`toast ${toast.type==='error'?'toast-error':''}`} key={toast.id}><Icon name={toast.type==='error'?'alert':'check'} size={18} /><span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToasts(previous => previous.filter(item => item.id!==toast.id))}><Icon name="close" size={15} /></button></div>)}</div>
    <ModalHost />
  </div>;
}
