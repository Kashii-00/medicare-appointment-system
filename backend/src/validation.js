import { AppError } from './errors.js';

const fail = message => { throw new AppError(400, message, 'VALIDATION_ERROR'); };

export function integer(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' ||
      (typeof value !== 'number' && typeof value !== 'string')) fail(`${name} must be an integer.`);
  if (typeof value === 'string' && !/^\d+$/.test(value)) fail(`${name} must be a decimal integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail(`${name} must be between ${min} and ${max}.`);
  return number;
}

export function text(value, name, { max = 100, optional = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (optional) return null;
    fail(`${name} is required.`);
  }
  if (typeof value !== 'string') fail(`${name} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (optional) return null;
    fail(`${name} is required.`);
  }
  if ([...trimmed].length > max) fail(`${name} must be at most ${max} characters.`);
  return trimmed;
}

export function choice(value, name, values, optional = false) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || !values.includes(value)) fail(`${name} must be one of: ${values.join(', ')}.`);
  return value;
}

export function money(value, name = 'amount', { allowZero = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > 99999999.99 ||
      value < 0 || (!allowZero && value === 0) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    fail(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} amount with at most two decimal places.`);
  }
  return Math.round(value * 100) / 100;
}

export function dateOnly(value, name, optional = false) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value.slice(0, 4) === '0000') {
    fail(`${name} is not a valid date.`);
  }
  return value;
}

export function clinicTimestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    fail(`${name} must be clinic-local YYYY-MM-DDTHH:mm[:ss], without a timezone suffix.`);
  }
  dateOnly(value.slice(0, 10), name);
  const parts = value.slice(11).split(':').map(Number);
  if (parts[0] > 23 || parts[1] > 59 || (parts[2] || 0) > 59) fail(`${name} is not a valid time.`);
  return value.length === 16 ? `${value}:00` : value;
}

export function objectBody(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object') fail('A JSON object is required.');
  const unknown = Object.keys(body).filter(key => !allowed.includes(key));
  if (unknown.length) fail(`Unknown field(s): ${unknown.join(', ')}.`);
  return body;
}

export function idList(value, name) {
  if (!Array.isArray(value) || !value.length || value.length > 30) fail(`${name} needs between 1 and 30 IDs.`);
  const ids = value.map(item => integer(item, name));
  if (new Set(ids).size !== ids.length) fail(`${name} contains duplicate IDs.`);
  return ids;
}

export const masterFields = {
  patients: { required: ['first_name','last_name','date_of_birth','phone'], fields: ['first_name','last_name','date_of_birth','gender','phone','email','address','active_flag'] },
  doctors: { required: ['registration_no','first_name','last_name','phone','specialization_ids'], fields: ['registration_no','first_name','last_name','phone','email','active_flag','specialization_ids'] },
  clinics: { required: ['clinic_name','address','city','phone'], fields: ['clinic_name','facility_type','address','city','phone','active_flag'] },
  specializations: { required: ['specialization_name'], fields: ['specialization_name','description'] },
  medicines: { required: ['medicine_name','strength','dosage_form'], fields: ['medicine_name','strength','dosage_form','active_flag'] }
};

export function master(resource, body, { partial = false } = {}) {
  const definition = masterFields[resource];
  objectBody(body, definition.fields);
  if (!Object.keys(body).length) fail('Provide at least one field.');
  if (!partial) for (const field of definition.required) if (!(field in body)) fail(`${field} is required.`);
  const result = {};
  const sizes = { first_name: 80, last_name: 80, registration_no: 30, phone: 30, email: 254, address: 500,
    clinic_name: 150, city: 80, specialization_name: 100, description: 500, medicine_name: 150, strength: 80, dosage_form: 50 };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'specialization_ids') result[key] = idList(value, key);
    else if (key === 'date_of_birth') {
      result[key] = dateOnly(value, key);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const part = type => parts.find(item => item.type === type).value;
      const today = `${part('year')}-${part('month')}-${part('day')}`;
      if (value > today) fail('date_of_birth cannot be in the future.');
    } else if (key === 'active_flag') result[key] = choice(value, key, ['Y','N']);
    else if (key === 'gender') result[key] = choice(value, key, ['MALE','FEMALE','OTHER','UNSPECIFIED']);
    else if (key === 'facility_type') result[key] = choice(value, key, ['HOSPITAL','CLINIC']);
    else {
      result[key] = text(value, key, { max: sizes[key], optional: ['email','address','description'].includes(key) && !definition.required.includes(key) });
      if (key === 'email' && result[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result[key])) fail('email is not valid.');
    }
  }
  return result;
}

export function page(query) {
  return { limit: integer(query.limit ?? 100, 'limit', { max: 200 }), offset: integer(query.offset ?? 0, 'offset', { min: 0, max: 100000 }) };
}

export function dateRange(query, { required = false } = {}) {
  const from = dateOnly(query.from, 'from', !required);
  const to = dateOnly(query.to, 'to', !required);
  if (from && to && from > to) fail('from must be on or before to.');
  return { from, to };
}
