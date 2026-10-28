export const API_BASE = import.meta.env?.VITE_API_URL || '/api';
let localSequence = 0;
// These IDs identify temporary UI rows/toasts, not users or credentials.
export function localId() {
  return globalThis.crypto?.randomUUID?.() || `mc-${Date.now().toString(36)}-${++localSequence}`;
}

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach MediCare. Check that the backend is running, then retry.', 0, 'CONNECTION_FAILED');
  }
  let result;
  try { result = await response.json(); }
  catch { throw new ApiError('MediCare returned an unexpected response. Check the backend connection.', response.status, 'INVALID_RESPONSE'); }
  if (!response.ok) throw new ApiError(result.error?.message || 'The request could not be completed.', response.status, result.error?.code);
  return result;
}

export function queryString(values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const string = query.toString();
  return string ? `?${string}` : '';
}

export async function allRows(path, signal) {
  const rows = [];
  let offset = 0;
  while (true) {
    const join = path.includes('?') ? '&' : '?';
    const result = await api(`${path}${join}limit=200&offset=${offset}`, { signal });
    rows.push(...result.data);
    if (!result.pagination?.has_more) break;
    if (!result.data.length) throw new ApiError('The record list could not be loaded completely.', 500, 'PAGINATION_ERROR');
    offset += result.data.length;
  }
  return rows;
}

const clinicParts = value => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(value);
export function today() {
  const parts = clinicParts(new Date());
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export const money = value => new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 2 }).format(Number(value || 0));
export const number = value => new Intl.NumberFormat('en-LK').format(Number(value || 0));
export function dateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value));
}
export function timeOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value));
}
export function dateOnly(value) {
  if (!value) return '—';
  const day = value.slice(0, 10);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
}
export const titleCase = value => String(value || '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
export const fullName = row => `${row.first_name} ${row.last_name}`;
export const reference = (prefix, id) => `${prefix}-${String(id).padStart(3, '0')}`;
export const hasStarted = appointment => Date.parse(appointment.appointment_start) <= Date.now();
export const canConsult = appointment => ['BOOKED','CONFIRMED'].includes(appointment.status) && hasStarted(appointment);

export function csvText(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const cell = value => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\t\r]/.test(text) || /^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\ufeff' + [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n');
}
export function downloadCsv(rows, filename) {
  const blob = new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
