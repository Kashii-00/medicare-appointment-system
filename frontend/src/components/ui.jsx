import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { titleCase } from '../lib.js';

const paths = {
  plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6L6 18', search: 'm21 21-4.5-4.5M19 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  calendar: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 13h3M14 13h3M7 17h3',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  doctor: 'M6 3v5a6 6 0 0 0 12 0V3M4 3h4M16 3h4M12 14v2a5 5 0 0 0 10 0v-2M22 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  clinic: 'M4 22V4h16v18M2 22h20M9 22v-6h6v6M12 7v6M9 10h6',
  notes: 'M8 3H5v19h14V3h-3M8 2h8v4H8zM8 11h8M8 15h8M8 19h4',
  wallet: 'M20 8V4H4a2 2 0 0 0 0 4h17v12H4V8M17 12h4v4h-4z',
  chart: 'M4 3v18h18M8 16v-5M13 16V7M18 16v-9',
  pill: 'm8 16 8-8M5 19a5 5 0 0 1 0-7l7-7a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7 0',
  layers: 'm12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',
  arrow: 'M5 12h14m-6-6 6 6-6 6', chevron: 'm9 5 7 7-7 7', check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  edit: 'm16 3 5 5-12 12-6 1 1-6zM14 5l5 5', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  refresh: 'M20 7A9 9 0 1 0 21 15M20 2v6h-6', alert: 'm12 3 10 18H2zM12 9v5M12 17v1',
  menu: 'M3 6h18M3 12h18M3 18h18', heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'
};
export function Icon({ name = 'grid', size = 20, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.grid} /></svg>;
}
export function Button({ children, variant = 'primary', icon, busy, className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy}>
    {busy ? <span className="spinner small" /> : icon && <Icon name={icon} size={17} />}{children}
  </button>;
}
export function Badge({ status }) {
  const style = ['COMPLETED','Y'].includes(status) ? 'green' : ['CONFIRMED','SCHEDULED'].includes(status) ? 'teal' : status === 'BOOKED' ? 'blue' : ['CANCELLED','VOIDED','N'].includes(status) ? 'gray' : 'amber';
  return <span className={`badge badge-${style}`}><span />{status === 'Y' ? 'Active' : status === 'N' ? 'Inactive' : titleCase(status)}</span>;
}
export function Avatar({ name = '', id = 0, size = '' }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('');
  return <span className={`avatar avatar-${Number(id) % 5} ${size}`} aria-hidden="true">{initials}</span>;
}
export function Person({ name, secondary, id, icon }) {
  return <div className="person">{icon ? <span className="person-icon"><Icon name={icon} /></span> : <Avatar name={name} id={id} />}<div><strong>{name}</strong>{secondary && <span className="cell-secondary">{secondary}</span>}</div></div>;
}
export function PageHeader({ eyebrow, title, description, children }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div><div className="heading-actions">{children}</div></div>;
}
export function ErrorNotice({ error, retry }) {
  if (!error) return null;
  return <div className="error-notice" role="alert"><Icon name="alert" /><div><strong>We couldn’t complete that request.</strong><p>{typeof error === 'string' ? error : error.message}</p></div>{retry && <Button variant="secondary" onClick={retry}>Retry</Button>}</div>;
}
export function Loading({ label = 'Loading records…' }) {
  return <div className="loading-state" role="status"><span className="spinner" /><span>{label}</span></div>;
}
export function Empty({ title = 'No records found', description = 'Try a different filter or add a new record.', icon = 'notes', action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Field({ label, hint, required, children, className = '' }) {
  return <label className={`field ${className}`}><span className="field-label">{label}{required && <span className="required"> *</span>}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Select({ children, ...props }) { return <select {...props}>{children}</select>; }
export function Dialog({ title, subtitle, onClose, children, wide = false, busy = false }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => { if (dialog.open) dialog.close(); }; }, []);
  return createPortal(<dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="dialog-header"><div><span className="eyebrow">MEDICARE WORKSPACE</span><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>{children}
  </dialog>, document.body);
}
export function Table({ columns, rows, rowKey, loading, empty, caption }) {
  if (loading) return <Loading />;
  if (!rows.length) return empty || <Empty />;
  return <div className="table-scroll"><table><caption className="sr-only">{caption || 'Records'}</caption><thead><tr>{columns.map(column => <th key={column.key} scope="col" className={column.className}>{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row[rowKey] ?? index}>{columns.map(column => <td key={column.key} className={column.className}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}
export function Pagination({ pagination, offset, onChange, limit = 10 }) {
  return <div className="pagination"><span>{pagination?.count ? `Showing ${offset + 1}–${offset + pagination.count}` : 'No records to show'}</span><div>
    <Button variant="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
    <Button variant="secondary" disabled={!pagination?.has_more} onClick={() => onChange(offset + limit)}>Next</Button></div></div>;
}
export function AmountSummary({ fee, paid, balance }) {
  const formatter = value => new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(Number(value || 0));
  return <div className="amount-summary"><div><span>Appointment fee</span><strong>{formatter(fee)}</strong></div><div><span>Paid</span><strong>{formatter(paid)}</strong></div><div><span>Balance due</span><strong>{formatter(balance)}</strong></div></div>;
}
