import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { AppError, publicError } from './errors.js';
import * as v from './validation.js';

const appointmentStatuses = ['BOOKED','CONFIRMED','CANCELLED','COMPLETED','NO_SHOW'];
const sessionStatuses = ['SCHEDULED','COMPLETED','CANCELLED'];
export const reports = [
  { name: 'appointment-summary', title: 'Appointment summary', parameters: ['from','to'] },
  { name: 'doctor-workload', title: 'Doctor workload', parameters: ['from','to'] },
  { name: 'clinic-revenue', title: 'Clinic revenue', parameters: ['from','to'] },
  { name: 'outstanding-balances', title: 'Outstanding balances', parameters: [] },
  { name: 'patient-history', title: 'Patient consultation history', parameters: ['patient_id'] }
];

const optionalId = (value, name) => value === undefined || value === '' ? null : v.integer(value, name);
const pathId = req => v.integer(req.params.id, 'id');
const dataResponse = (res, result, status = 200) => res.status(status).json({ data: result });

export function createApp(service, { origins = ['http://localhost:5173','http://127.0.0.1:5173'], logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(cors({
    origin(origin, done) {
      if (!origin || origins.includes(origin)) return done(null, true);
      return done(new AppError(403, 'This browser origin is not allowed.', 'ORIGIN_NOT_ALLOWED'));
    },
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS']
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => res.json({ name: 'MediCare API', version: '1.0.0', health: '/api/health', reports: '/api/reports' }));
  app.get('/api/health', async (_req, res) => res.json(await service.health()));
  app.get('/api/dashboard', async (_req, res) => dataResponse(res, await service.dashboard()));

  for (const resource of Object.keys(v.masterFields)) {
    const base = `/api/${resource}`;
    app.get(base, async (req, res) => {
      const filters = { ...v.page(req.query), q: v.text(req.query.q, 'q', { max: 100, optional: true }) };
      if (resource !== 'specializations') filters.active_flag = v.choice(req.query.active_flag, 'active_flag', ['Y','N'], true);
      if (resource === 'doctors') filters.specialization_id = optionalId(req.query.specialization_id, 'specialization_id');
      res.json(await service.listMaster(resource, filters));
    });
    app.get(`${base}/:id`, async (req, res) => dataResponse(res, await service.getMaster(resource, pathId(req))));
    app.post(base, async (req, res) => dataResponse(res, await service.createMaster(resource, v.master(resource, req.body)), 201));
    app.put(`${base}/:id`, async (req, res) => dataResponse(res, await service.updateMaster(resource, pathId(req), v.master(resource, req.body))));
    app.patch(`${base}/:id`, async (req, res) => dataResponse(res, await service.updateMaster(resource, pathId(req), v.master(resource, req.body, { partial: true }))));
  }
  app.delete('/api/specializations/:id', async (req, res) => dataResponse(res, await service.deleteSpecialization(pathId(req))));

  app.get('/api/sessions', async (req, res) => {
    const upcoming = v.choice(req.query.upcoming, 'upcoming', ['true','false'], true);
    res.json(await service.listSessions({ ...v.page(req.query), ...v.dateRange(req.query),
      doctor_id: optionalId(req.query.doctor_id, 'doctor_id'), clinic_id: optionalId(req.query.clinic_id, 'clinic_id'),
      status: v.choice(req.query.status, 'status', sessionStatuses, true), upcoming: upcoming === 'true'
    }));
  });
  app.get('/api/sessions/:id/slots', async (req, res) => dataResponse(res, await service.sessionSlots(pathId(req))));
  app.post('/api/sessions', async (req, res) => {
    const body = v.objectBody(req.body, ['doctor_id','clinic_id','start_time','end_time','slot_minutes','consultation_fee']);
    const data = {
      doctor_id: v.integer(body.doctor_id, 'doctor_id'), clinic_id: v.integer(body.clinic_id, 'clinic_id'),
      start_time: v.clinicTimestamp(body.start_time, 'start_time'), end_time: v.clinicTimestamp(body.end_time, 'end_time'),
      slot_minutes: v.integer(body.slot_minutes ?? 15, 'slot_minutes', { min: 5, max: 120 }),
      consultation_fee: v.money(body.consultation_fee, 'consultation_fee', { allowZero: true })
    };
    if (data.start_time >= data.end_time) throw new AppError(400, 'end_time must be after start_time.', 'VALIDATION_ERROR');
    dataResponse(res, await service.createSession(data), 201);
  });
  app.patch('/api/sessions/:id/fee', async (req, res) => {
    const body = v.objectBody(req.body, ['consultation_fee']);
    dataResponse(res, await service.changeSessionFee(pathId(req), v.money(body.consultation_fee, 'consultation_fee', { allowZero: true })));
  });
  app.patch('/api/sessions/:id/cancel', async (req, res) => {
    const body = v.objectBody(req.body, ['reason']);
    dataResponse(res, await service.sessionAction(pathId(req), 'cancel', v.text(body.reason, 'reason', { max: 500 })));
  });
  app.patch('/api/sessions/:id/complete', async (req, res) => {
    v.objectBody(req.body ?? {}, []);
    dataResponse(res, await service.sessionAction(pathId(req), 'complete', null));
  });

  app.get('/api/appointments', async (req, res) => res.json(await service.listAppointments({
    ...v.page(req.query), ...v.dateRange(req.query), patient_id: optionalId(req.query.patient_id, 'patient_id'),
    doctor_id: optionalId(req.query.doctor_id, 'doctor_id'), session_id: optionalId(req.query.session_id, 'session_id'),
    status: v.choice(req.query.status, 'status', appointmentStatuses, true)
  })));
  app.get('/api/appointments/:id', async (req, res) => dataResponse(res, await service.getAppointment(pathId(req))));
  app.post('/api/appointments', async (req, res) => {
    const body = v.objectBody(req.body, ['patient_id','session_id','slot_no']);
    dataResponse(res, await service.bookAppointment({ patient_id: v.integer(body.patient_id, 'patient_id'),
      session_id: v.integer(body.session_id, 'session_id'), slot_no: v.integer(body.slot_no, 'slot_no', { max: 9999 }) }), 201);
  });
  for (const action of ['confirm','cancel','no-show']) {
    app.patch(`/api/appointments/:id/${action}`, async (req, res) => {
      const body = v.objectBody(req.body ?? {}, action === 'cancel' ? ['reason'] : []);
      const reason = action === 'cancel' ? v.text(body.reason, 'reason', { max: 500 }) : null;
      dataResponse(res, await service.appointmentAction(pathId(req), action, reason));
    });
  }

  app.get('/api/consultations', async (req, res) => res.json(await service.listConsultations({
    ...v.page(req.query), patient_id: optionalId(req.query.patient_id, 'patient_id')
  })));
  app.get('/api/consultations/:id', async (req, res) => dataResponse(res, await service.getConsultation(pathId(req))));
  app.post('/api/consultations', async (req, res) => {
    const body = v.objectBody(req.body, ['appointment_id','symptoms','diagnosis','clinical_notes','follow_up_date']);
    dataResponse(res, await service.recordConsultation({
      appointment_id: v.integer(body.appointment_id, 'appointment_id'),
      symptoms: v.text(body.symptoms, 'symptoms', { max: 2000, optional: true }),
      diagnosis: v.text(body.diagnosis, 'diagnosis', { max: 2000 }),
      clinical_notes: v.text(body.clinical_notes, 'clinical_notes', { max: 20000, optional: true }),
      follow_up_date: v.dateOnly(body.follow_up_date, 'follow_up_date', true)
    }), 201);
  });
  app.post('/api/prescriptions', async (req, res) => {
    const body = v.objectBody(req.body, ['consultation_id','items','notes']);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 999) throw new AppError(400, 'Provide between 1 and 999 prescription items.', 'VALIDATION_ERROR');
    const items = body.items.map((item, index) => {
      v.objectBody(item, ['medicine_id','dosage','frequency','duration_days','instructions']);
      return { medicine_id: v.integer(item.medicine_id, `items[${index}].medicine_id`),
        dosage: v.text(item.dosage, 'dosage', { max: 100 }), frequency: v.text(item.frequency, 'frequency', { max: 100 }),
        duration_days: v.integer(item.duration_days, 'duration_days', { max: 365 }),
        instructions: v.text(item.instructions, 'instructions', { max: 1000, optional: true }) ?? undefined };
    });
    dataResponse(res, await service.savePrescription({ consultation_id: v.integer(body.consultation_id, 'consultation_id'),
      notes: v.text(body.notes, 'notes', { max: 1000, optional: true }), items }), 201);
  });

  app.get('/api/payments', async (req, res) => res.json(await service.listPayments({
    ...v.page(req.query), appointment_id: optionalId(req.query.appointment_id, 'appointment_id'),
    status: v.choice(req.query.status, 'status', ['COMPLETED','VOIDED'], true)
  })));
  app.post('/api/payments', async (req, res) => {
    const body = v.objectBody(req.body, ['appointment_id','amount','payment_method','reference_no']);
    dataResponse(res, await service.recordPayment({ appointment_id: v.integer(body.appointment_id, 'appointment_id'),
      amount: v.money(body.amount), payment_method: v.choice(body.payment_method, 'payment_method', ['CASH','CARD','BANK_TRANSFER']),
      reference_no: v.text(body.reference_no, 'reference_no', { max: 100, optional: true }) }), 201);
  });
  app.patch('/api/payments/:id/void', async (req, res) => {
    v.objectBody(req.body ?? {}, []);
    dataResponse(res, await service.voidPayment(pathId(req)));
  });

  app.get('/api/reports', (_req, res) => res.json({ data: reports }));
  app.get('/api/reports/:name', async (req, res) => {
    const definition = reports.find(report => report.name === req.params.name);
    if (!definition) throw new AppError(404, 'Report not found.', 'NOT_FOUND');
    const filters = { limit: v.integer(req.query.limit ?? 5000, 'limit', { max: 10000 }) };
    if (definition.parameters.includes('from')) Object.assign(filters, v.dateRange(req.query, { required: true }));
    if (definition.parameters.includes('patient_id')) filters.patient_id = v.integer(req.query.patient_id, 'patient_id');
    res.json(await service.runReport(definition.name, filters));
  });

  app.use((_req, _res, next) => next(new AppError(404, 'Endpoint not found.', 'NOT_FOUND')));
  app.use((error, req, res, _next) => {
    const result = publicError(error);
    if (result.status >= 500) logger.error('Request failed:', req.requestId, error.code || error.errorNum || 'INTERNAL_ERROR');
    res.status(result.status).json({ error: { code: result.code, message: result.message, request_id: req.requestId } });
  });
  return app;
}
