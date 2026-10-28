import oracledb from 'oracledb';
import { AppError } from './errors.js';
import { normalizeRows } from './serialization.js';

const masters = Object.freeze({
  patients: { table: 'patients', id: 'patient_id', search: "first_name || ' ' || last_name || ' ' || phone", order: 'patient_id DESC' },
  doctors: { table: 'doctors', id: 'doctor_id', search: "d.first_name || ' ' || d.last_name || ' ' || d.registration_no", order: 'd.doctor_id DESC' },
  clinics: { table: 'clinics', id: 'clinic_id', search: "clinic_name || ' ' || city", order: 'clinic_id DESC' },
  specializations: { table: 'specializations', id: 'specialization_id', search: 'specialization_name', order: 'specialization_name' },
  medicines: { table: 'medicines', id: 'medicine_id', search: "medicine_name || ' ' || strength || ' ' || dosage_form", order: 'medicine_name' }
});

const doctorSelect = `SELECT d.*, x.specialization_ids, x.specializations
  FROM doctors d LEFT JOIN (
    SELECT ds.doctor_id,
      LISTAGG(ds.specialization_id, ',') WITHIN GROUP (ORDER BY ds.specialization_id) AS specialization_ids,
      LISTAGG(s.specialization_name, ', ') WITHIN GROUP (ORDER BY ds.specialization_id) AS specializations
    FROM doctor_specializations ds JOIN specializations s ON s.specialization_id=ds.specialization_id
    GROUP BY ds.doctor_id
  ) x ON x.doctor_id=d.doctor_id`;

const appointmentSelect = `SELECT d.*, b.paid_amount, b.balance_due
  FROM v_appointment_details d
  JOIN v_appointment_balances b ON b.appointment_id=d.appointment_id`;

const numberOut = () => ({ dir: oracledb.BIND_OUT, type: oracledb.NUMBER });
const outId = result => Array.isArray(result.outBinds.out_id) ? result.outBinds.out_id[0] : result.outBinds.out_id;
const missing = () => { throw new AppError(404, 'Record not found.', 'NOT_FOUND'); };

async function query(connection, sql, binds = {}) {
  return normalizeRows((await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows);
}

function masterRows(resource, rows) {
  return resource !== 'doctors' ? rows : rows.map(row => ({ ...row,
    specialization_ids: row.specialization_ids ? String(row.specialization_ids).split(',').map(Number) : []
  }));
}

function paged(rows, { limit, offset }) {
  return { data: rows.slice(0, limit), pagination: { limit, offset, count: Math.min(rows.length, limit), has_more: rows.length > limit } };
}

export function createService(db) {
  const read = work => db.withConnection(work);
  const write = work => db.withTransaction(work);

  async function setDoctorSpecializations(connection, doctorId, specializationIds) {
    await connection.execute('DELETE FROM doctor_specializations WHERE doctor_id=:id', { id: doctorId });
    for (const specializationId of specializationIds) {
      await connection.execute(`INSERT INTO doctor_specializations(doctor_id,specialization_id)
        VALUES(:doctor_id,:specialization_id)`, { doctor_id: doctorId, specialization_id: specializationId });
    }
  }

  async function detailMaster(connection, resource, id) {
    const def = masters[resource];
    const sql = resource === 'doctors' ? `${doctorSelect} WHERE d.doctor_id=:id` : `SELECT * FROM ${def.table} WHERE ${def.id}=:id`;
    const row = masterRows(resource, await query(connection, sql, { id }))[0];
    if (!row) missing();
    return row;
  }

  async function consultationDetail(connection, id) {
    const rows = await query(connection, `SELECT c.*, d.patient_id,d.patient_name,d.doctor_name,
        d.clinic_name,d.appointment_start
      FROM consultations c JOIN v_appointment_details d ON d.appointment_id=c.appointment_id
      WHERE c.consultation_id=:id`, { id });
    if (!rows[0]) missing();
    const prescriptions = await query(connection, 'SELECT * FROM prescriptions WHERE consultation_id=:id', { id });
    let prescription = null;
    if (prescriptions[0]) {
      const items = await query(connection, `SELECT i.*,m.medicine_name,m.strength,m.dosage_form
        FROM prescription_items i JOIN medicines m ON m.medicine_id=i.medicine_id
        WHERE i.prescription_id=:id ORDER BY i.line_no`, { id: prescriptions[0].prescription_id });
      prescription = { ...prescriptions[0], items };
    }
    return { ...rows[0], prescription };
  }

  return {
    health: () => read(async connection => {
      await connection.execute('SELECT 1 FROM dual');
      return { status: 'ok', database: 'connected', timezone: 'Asia/Colombo' };
    }),

    dashboard: () => read(async connection => (await query(connection, `SELECT
      (SELECT COUNT(*) FROM doctors WHERE active_flag='Y') AS active_doctors,
      (SELECT COUNT(*) FROM patients WHERE active_flag='Y') AS active_patients,
      (SELECT COUNT(*) FROM clinics WHERE active_flag='Y') AS active_clinics,
      (SELECT COUNT(*) FROM appointments) AS total_appointments,
      (SELECT COUNT(*) FROM appointments WHERE status IN ('BOOKED','CONFIRMED')) AS pending_appointments,
      (SELECT COUNT(*) FROM appointments WHERE status='COMPLETED') AS completed_appointments,
      (SELECT COUNT(*) FROM doctor_sessions WHERE status='SCHEDULED'
        AND end_time>CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS TIMESTAMP)) AS upcoming_sessions,
      (SELECT NVL(SUM(amount),0) FROM payments WHERE status='COMPLETED') AS collected_lkr,
      (SELECT NVL(SUM(amount),0) FROM payments WHERE status='COMPLETED'
        AND paid_at>=CAST(TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS DATE)) AS TIMESTAMP)
        AND paid_at<CAST(TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS DATE))+1 AS TIMESTAMP)) AS collected_today_lkr,
      (SELECT NVL(SUM(balance_due),0) FROM v_appointment_balances WHERE status<>'CANCELLED') AS outstanding_lkr
      FROM dual`))[0]),

    listMaster: (resource, filters) => read(async connection => {
      const def = masters[resource];
      const { limit, offset, q = '', active_flag = null, specialization_id = null } = filters;
      const prefix = resource === 'doctors' ? 'd.' : '';
      let sql = resource === 'doctors' ? doctorSelect : `SELECT * FROM ${def.table}`;
      sql += ` WHERE (:q IS NULL OR LOWER(${def.search}) LIKE :q)`;
      const binds = { q: q ? `%${q.toLowerCase()}%` : null, offset, fetch_limit: limit + 1 };
      if (resource !== 'specializations') {
        sql += ` AND (:active_flag IS NULL OR ${prefix}active_flag=:active_flag)`;
        binds.active_flag = active_flag;
      }
      if (resource === 'doctors') {
        sql += ` AND (:specialization_id IS NULL OR EXISTS (
          SELECT 1 FROM doctor_specializations ds WHERE ds.doctor_id=d.doctor_id
          AND ds.specialization_id=:specialization_id))`;
        binds.specialization_id = { val: specialization_id, type: oracledb.NUMBER };
      }
      sql += ` ORDER BY ${def.order} OFFSET :offset ROWS FETCH NEXT :fetch_limit ROWS ONLY`;
      return paged(masterRows(resource, await query(connection, sql, binds)), filters);
    }),

    getMaster: (resource, id) => read(connection => detailMaster(connection, resource, id)),

    createMaster: (resource, data) => write(async connection => {
      const def = masters[resource];
      const { specialization_ids, ...fields } = data;
      // Field names come from validation.master's fixed allowlist, never raw JSON.
      const names = Object.keys(fields);
      const values = names.map(name => name === 'date_of_birth' ? `TO_DATE(:${name},'YYYY-MM-DD')` : `:${name}`);
      const result = await connection.execute(`INSERT INTO ${def.table}(${names.join(',')})
        VALUES(${values.join(',')}) RETURNING ${def.id} INTO :out_id`, { ...fields, out_id: numberOut() });
      const id = outId(result);
      if (resource === 'doctors') await setDoctorSpecializations(connection, id, specialization_ids);
      return detailMaster(connection, resource, id);
    }),

    updateMaster: (resource, id, data) => write(async connection => {
      const def = masters[resource];
      if (!(await query(connection, `SELECT ${def.id} FROM ${def.table} WHERE ${def.id}=:id FOR UPDATE`, { id })).length) missing();
      const { specialization_ids, ...fields } = data;
      const names = Object.keys(fields);
      if (names.length) {
        const set = names.map(name => `${name}=${name === 'date_of_birth' ? `TO_DATE(:${name},'YYYY-MM-DD')` : `:${name}`}`);
        await connection.execute(`UPDATE ${def.table} SET ${set.join(',')} WHERE ${def.id}=:id`, { ...fields, id });
      }
      if (resource === 'doctors' && specialization_ids) await setDoctorSpecializations(connection, id, specialization_ids);
      return detailMaster(connection, resource, id);
    }),

    deleteSpecialization: id => write(async connection => {
      const result = await connection.execute('DELETE FROM specializations WHERE specialization_id=:id', { id });
      if (!result.rowsAffected) missing();
      return { deleted: true };
    }),

    listSessions: filters => read(async connection => {
      const rows = await query(connection, `SELECT s.*,d.first_name || ' ' || d.last_name AS doctor_name,
          c.clinic_name,c.city,
          FLOOR(ROUND((CAST(s.end_time AS DATE)-CAST(s.start_time AS DATE))*86400)/(s.slot_minutes*60)) AS capacity,
          (SELECT COUNT(*) FROM appointments a WHERE a.session_id=s.session_id AND a.status<>'CANCELLED') AS booked_slots
        FROM doctor_sessions s JOIN doctors d ON d.doctor_id=s.doctor_id
        JOIN clinics c ON c.clinic_id=s.clinic_id
        WHERE (:doctor_id IS NULL OR s.doctor_id=:doctor_id)
          AND (:clinic_id IS NULL OR s.clinic_id=:clinic_id)
          AND (:status IS NULL OR s.status=:status)
          AND (:from_date IS NULL OR s.start_time>=TO_DATE(:from_date,'YYYY-MM-DD'))
          AND (:to_date IS NULL OR s.start_time<TO_DATE(:to_date,'YYYY-MM-DD')+1)
          AND (:upcoming=0 OR (s.status='SCHEDULED' AND s.end_time>
            CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS TIMESTAMP)))
        ORDER BY s.start_time,s.session_id OFFSET :offset ROWS FETCH NEXT :fetch_limit ROWS ONLY`, {
        doctor_id: { val: filters.doctor_id, type: oracledb.NUMBER },
        clinic_id: { val: filters.clinic_id, type: oracledb.NUMBER }, status: filters.status,
        from_date: filters.from, to_date: filters.to, upcoming: filters.upcoming ? 1 : 0,
        offset: filters.offset, fetch_limit: filters.limit + 1
      });
      return paged(rows, filters);
    }),

    sessionSlots: id => read(async connection => {
      const rows = await query(connection, `SELECT s.*,
        FLOOR(ROUND((CAST(end_time AS DATE)-CAST(start_time AS DATE))*86400)/(slot_minutes*60)) AS capacity
        FROM doctor_sessions s WHERE session_id=:id`, { id });
      if (!rows[0]) missing();
      const session = rows[0];
      if (session.capacity < 1) return { session, slots: [] };
      const slots = await query(connection, `WITH slot_numbers AS (
          SELECT LEVEL AS slot_no FROM dual CONNECT BY LEVEL<=:capacity
        )
        SELECT n.slot_no,
          s.start_time+NUMTODSINTERVAL((n.slot_no-1)*s.slot_minutes,'MINUTE') AS start_time,
          s.start_time+NUMTODSINTERVAL(n.slot_no*s.slot_minutes,'MINUTE') AS end_time,
          a.appointment_id,a.status AS appointment_status,
          p.first_name || ' ' || p.last_name AS patient_name,
          CASE WHEN a.appointment_id IS NULL AND s.status='SCHEDULED'
            AND d.active_flag='Y' AND c.active_flag='Y'
            AND s.start_time+NUMTODSINTERVAL((n.slot_no-1)*s.slot_minutes,'MINUTE')>
              CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS TIMESTAMP)
            THEN 'Y' ELSE 'N' END AS available
        FROM slot_numbers n CROSS JOIN doctor_sessions s
        JOIN doctors d ON d.doctor_id=s.doctor_id JOIN clinics c ON c.clinic_id=s.clinic_id
        LEFT JOIN appointments a ON a.session_id=s.session_id AND a.slot_no=n.slot_no AND a.status<>'CANCELLED'
        LEFT JOIN patients p ON p.patient_id=a.patient_id
        WHERE s.session_id=:id ORDER BY n.slot_no`, { capacity: session.capacity, id });
      return { session, slots };
    }),

    createSession: data => write(async connection => {
      const result = await connection.execute(`BEGIN mc_api.create_session(
        :doctor_id,:clinic_id,TO_TIMESTAMP(:start_time,'YYYY-MM-DD"T"HH24:MI:SS'),
        TO_TIMESTAMP(:end_time,'YYYY-MM-DD"T"HH24:MI:SS'),:slot_minutes,:consultation_fee,:out_id); END;`,
      { ...data, out_id: numberOut() });
      return { session_id: outId(result) };
    }),

    changeSessionFee: (id, fee) => write(async connection => {
      const rows = await query(connection, 'SELECT status FROM doctor_sessions WHERE session_id=:id FOR UPDATE', { id });
      if (!rows[0]) missing();
      if (rows[0].status !== 'SCHEDULED') throw new AppError(409, 'Only a scheduled session can have its fee changed.');
      await connection.execute('UPDATE doctor_sessions SET consultation_fee=:fee WHERE session_id=:id', { fee, id });
      return { session_id: id, consultation_fee: fee };
    }),

    sessionAction: (id, action, reason) => write(async connection => {
      if (action === 'cancel') await connection.execute('BEGIN mc_api.cancel_session(:id,:reason); END;', { id, reason });
      else await connection.execute('BEGIN mc_api.finish_session(:id); END;', { id });
      return { session_id: id, status: action === 'cancel' ? 'CANCELLED' : 'COMPLETED' };
    }),

    listAppointments: filters => read(async connection => {
      const rows = await query(connection, `${appointmentSelect}
        WHERE (:patient_id IS NULL OR d.patient_id=:patient_id)
          AND (:doctor_id IS NULL OR d.doctor_id=:doctor_id)
          AND (:session_id IS NULL OR d.session_id=:session_id)
          AND (:status IS NULL OR d.status=:status)
          AND (:from_date IS NULL OR d.appointment_start>=TO_DATE(:from_date,'YYYY-MM-DD'))
          AND (:to_date IS NULL OR d.appointment_start<TO_DATE(:to_date,'YYYY-MM-DD')+1)
        ORDER BY d.appointment_start DESC,d.appointment_id DESC
        OFFSET :offset ROWS FETCH NEXT :fetch_limit ROWS ONLY`, {
        patient_id: { val: filters.patient_id, type: oracledb.NUMBER },
        doctor_id: { val: filters.doctor_id, type: oracledb.NUMBER },
        session_id: { val: filters.session_id, type: oracledb.NUMBER },
        status: filters.status, from_date: filters.from, to_date: filters.to,
        offset: filters.offset, fetch_limit: filters.limit + 1
      });
      return paged(rows, filters);
    }),

    getAppointment: id => read(async connection => {
      const rows = await query(connection, `${appointmentSelect} WHERE d.appointment_id=:id`, { id });
      if (!rows[0]) missing();
      const consultations = await query(connection, 'SELECT consultation_id FROM consultations WHERE appointment_id=:id', { id });
      const consultation = consultations[0] ? await consultationDetail(connection, consultations[0].consultation_id) : null;
      const payments = await query(connection, 'SELECT * FROM payments WHERE appointment_id=:id ORDER BY payment_id', { id });
      return { ...rows[0], consultation, payments };
    }),

    bookAppointment: data => write(async connection => {
      const result = await connection.execute('BEGIN mc_api.book_appointment(:patient_id,:session_id,:slot_no,:out_id); END;', { ...data, out_id: numberOut() });
      return { appointment_id: outId(result) };
    }),

    appointmentAction: (id, action, reason) => write(async connection => {
      const statements = {
        confirm: 'BEGIN mc_api.confirm_appointment(:id); END;',
        cancel: 'BEGIN mc_api.cancel_appointment(:id,:reason); END;',
        'no-show': 'BEGIN mc_api.mark_no_show(:id); END;'
      };
      await connection.execute(statements[action], action === 'cancel' ? { id, reason } : { id });
      return { appointment_id: id, status: { confirm: 'CONFIRMED', cancel: 'CANCELLED', 'no-show': 'NO_SHOW' }[action] };
    }),

    listConsultations: filters => read(async connection => {
      const rows = await query(connection, `SELECT c.*,d.patient_id,d.patient_name,d.doctor_name,d.clinic_name,d.appointment_start
        FROM consultations c JOIN v_appointment_details d ON d.appointment_id=c.appointment_id
        WHERE (:patient_id IS NULL OR d.patient_id=:patient_id)
        ORDER BY c.consulted_at DESC,c.consultation_id DESC
        OFFSET :offset ROWS FETCH NEXT :fetch_limit ROWS ONLY`, {
        patient_id: { val: filters.patient_id, type: oracledb.NUMBER }, offset: filters.offset, fetch_limit: filters.limit + 1
      });
      return paged(rows, filters);
    }),

    getConsultation: id => read(connection => consultationDetail(connection, id)),

    recordConsultation: data => write(async connection => {
      const { clinical_notes, ...fields } = data;
      const result = await connection.execute(`BEGIN mc_api.record_consultation(
        :appointment_id,:symptoms,:diagnosis,:clinical_notes,TO_DATE(:follow_up_date,'YYYY-MM-DD'),:out_id); END;`,
      { ...fields, clinical_notes: { val: clinical_notes, type: oracledb.CLOB }, out_id: numberOut() });
      return { consultation_id: outId(result) };
    }),

    savePrescription: data => write(async connection => {
      const result = await connection.execute('BEGIN mc_api.save_prescription(:consultation_id,:items,:notes,:out_id); END;', {
        consultation_id: data.consultation_id, items: { val: JSON.stringify(data.items), type: oracledb.CLOB },
        notes: data.notes, out_id: numberOut()
      });
      return { prescription_id: outId(result) };
    }),

    listPayments: filters => read(async connection => {
      const rows = await query(connection, `SELECT p.*,d.patient_name,d.doctor_name,d.clinic_name
        FROM payments p JOIN v_appointment_details d ON d.appointment_id=p.appointment_id
        WHERE (:appointment_id IS NULL OR p.appointment_id=:appointment_id)
          AND (:status IS NULL OR p.status=:status)
        ORDER BY p.paid_at DESC,p.payment_id DESC OFFSET :offset ROWS FETCH NEXT :fetch_limit ROWS ONLY`, {
        appointment_id: { val: filters.appointment_id, type: oracledb.NUMBER }, status: filters.status,
        offset: filters.offset, fetch_limit: filters.limit + 1
      });
      return paged(rows, filters);
    }),

    recordPayment: data => write(async connection => {
      const result = await connection.execute('BEGIN mc_api.record_payment(:appointment_id,:amount,:payment_method,:reference_no,:out_id); END;',
        { ...data, out_id: numberOut() });
      return { payment_id: outId(result) };
    }),

    voidPayment: id => write(async connection => {
      await connection.execute('BEGIN mc_api.void_payment(:id); END;', { id });
      return { payment_id: id, status: 'VOIDED' };
    }),

    runReport: (name, filters) => read(async connection => {
      const definitions = {
        'appointment-summary': 'BEGIN mc_reports.appointment_summary(TO_DATE(:from_date,\'YYYY-MM-DD\'),TO_DATE(:to_date,\'YYYY-MM-DD\'),:rows); END;',
        'doctor-workload': 'BEGIN mc_reports.doctor_workload(TO_DATE(:from_date,\'YYYY-MM-DD\'),TO_DATE(:to_date,\'YYYY-MM-DD\'),:rows); END;',
        'clinic-revenue': 'BEGIN mc_reports.clinic_revenue(TO_DATE(:from_date,\'YYYY-MM-DD\'),TO_DATE(:to_date,\'YYYY-MM-DD\'),:rows); END;',
        'outstanding-balances': 'BEGIN mc_reports.outstanding_balances(:rows); END;',
        'patient-history': 'BEGIN mc_reports.patient_history(:patient_id,:rows); END;'
      };
      const binds = { rows: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR } };
      if (['appointment-summary','doctor-workload','clinic-revenue'].includes(name)) {
        binds.from_date = filters.from; binds.to_date = filters.to;
      }
      if (name === 'patient-history') binds.patient_id = filters.patient_id;
      const result = await connection.execute(definitions[name], binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const cursor = result.outBinds.rows;
      const rows = [];
      try {
        while (rows.length <= filters.limit) {
          const batch = await cursor.getRows(Math.min(200, filters.limit + 1 - rows.length));
          if (!batch.length) break;
          rows.push(...batch);
        }
      } finally {
        await cursor.close();
      }
      return { data: normalizeRows(rows.slice(0, filters.limit)), meta: {
        report: name, row_count: Math.min(rows.length, filters.limit), limit: filters.limit, truncated: rows.length > filters.limit
      } };
    })
  };
}
