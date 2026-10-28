-- MediCare stage 2: procedures, functions, triggers and business reports.
-- Connect as MEDICARE to FREEPDB1. This script is safe to rerun: it replaces
-- program objects/views, but does not remove or reload application data.
-- Revision 2: timestamp precision uses typed variables; prescription JSON
-- uses PL/SQL JSON object methods rather than JSON_TABLE in a cursor.
-- Business procedures do not COMMIT. The caller commits on success.
-- Applications must use MC_API for scheduling, payments and consultations;
-- cross-row validation/locking is implemented there, not by arbitrary DML.

SET DEFINE OFF
SET SQLBLANKLINES ON
SET SERVEROUTPUT ON
SET LINESIZE 180
SET PAGESIZE 100
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
ALTER SESSION SET TIME_ZONE = 'Asia/Colombo';

BEGIN
    IF SYS_CONTEXT('USERENV','SESSION_USER') <> 'MEDICARE'
       OR SYS_CONTEXT('USERENV','CON_NAME') <> 'FREEPDB1' THEN
        RAISE_APPLICATION_ERROR(-20100, 'Connect as MEDICARE to FREEPDB1.');
    END IF;
END;
/

CREATE OR REPLACE VIEW v_appointment_details AS
SELECT a.appointment_id, a.patient_id,
       p.first_name || ' ' || p.last_name AS patient_name,
       s.session_id, s.doctor_id,
       d.first_name || ' ' || d.last_name AS doctor_name,
       s.clinic_id, c.clinic_name, c.city,
       s.start_time AS session_start, s.end_time AS session_end,
       s.start_time + NUMTODSINTERVAL((a.slot_no - 1) * s.slot_minutes, 'MINUTE')
           AS appointment_start,
       s.start_time + NUMTODSINTERVAL(a.slot_no * s.slot_minutes, 'MINUTE')
           AS appointment_end,
       a.slot_no, a.status, a.agreed_fee, a.booked_at
FROM appointments a
JOIN patients p ON p.patient_id = a.patient_id
JOIN doctor_sessions s ON s.session_id = a.session_id
JOIN doctors d ON d.doctor_id = s.doctor_id
JOIN clinics c ON c.clinic_id = s.clinic_id;

CREATE OR REPLACE VIEW v_appointment_balances AS
SELECT a.appointment_id, a.patient_id, a.session_id, a.status, a.agreed_fee,
       NVL(p.paid_amount, 0) AS paid_amount,
       CASE WHEN a.status = 'CANCELLED' THEN 0
            ELSE a.agreed_fee - NVL(p.paid_amount, 0) END AS balance_due
FROM appointments a
LEFT JOIN (
    SELECT appointment_id, SUM(amount) AS paid_amount
    FROM payments WHERE status = 'COMPLETED'
    GROUP BY appointment_id
) p ON p.appointment_id = a.appointment_id;

CREATE OR REPLACE TRIGGER trg_patients_validate
BEFORE INSERT OR UPDATE ON patients
FOR EACH ROW
BEGIN
    :NEW.first_name := TRIM(:NEW.first_name);
    :NEW.last_name := TRIM(:NEW.last_name);
    :NEW.phone := TRIM(:NEW.phone);
    :NEW.email := LOWER(TRIM(:NEW.email));
    :NEW.date_of_birth := TRUNC(:NEW.date_of_birth);
    IF :NEW.date_of_birth > TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE
                                             'Asia/Colombo' AS DATE)) THEN
        RAISE_APPLICATION_ERROR(-20114, 'Date of birth cannot be in the future.');
    END IF;
END;
/

CREATE OR REPLACE TRIGGER trg_doctors_validate
BEFORE INSERT OR UPDATE ON doctors
FOR EACH ROW
BEGIN
    :NEW.registration_no := UPPER(TRIM(:NEW.registration_no));
    :NEW.first_name := TRIM(:NEW.first_name);
    :NEW.last_name := TRIM(:NEW.last_name);
    :NEW.phone := TRIM(:NEW.phone);
    :NEW.email := LOWER(TRIM(:NEW.email));
END;
/

CREATE OR REPLACE TRIGGER trg_sessions_history
BEFORE UPDATE OF doctor_id, clinic_id, start_time, end_time, slot_minutes
ON doctor_sessions FOR EACH ROW
DECLARE
    v_count PLS_INTEGER;
BEGIN
    IF :NEW.doctor_id <> :OLD.doctor_id OR :NEW.clinic_id <> :OLD.clinic_id
       OR :NEW.start_time <> :OLD.start_time OR :NEW.end_time <> :OLD.end_time
       OR :NEW.slot_minutes <> :OLD.slot_minutes THEN
        SELECT COUNT(*) INTO v_count FROM appointments
        WHERE session_id = :OLD.session_id;
        IF v_count > 0 THEN
            RAISE_APPLICATION_ERROR(-20113,
                'A session with booking history cannot be moved or resized.');
        END IF;
    END IF;
END;
/

CREATE OR REPLACE TRIGGER trg_appointments_history
BEFORE UPDATE ON appointments FOR EACH ROW
BEGIN
    IF :NEW.session_id <> :OLD.session_id OR :NEW.patient_id <> :OLD.patient_id
       OR :NEW.slot_no <> :OLD.slot_no OR :NEW.agreed_fee <> :OLD.agreed_fee
       OR :NEW.booked_at <> :OLD.booked_at THEN
        RAISE_APPLICATION_ERROR(-20113,
            'Booking identity, slot and agreed fee are immutable. Cancel and rebook.');
    END IF;
    IF :OLD.status IN ('COMPLETED','CANCELLED','NO_SHOW')
       AND :NEW.status <> :OLD.status THEN
        RAISE_APPLICATION_ERROR(-20109, 'This appointment has a final status.');
    END IF;
END;
/

CREATE OR REPLACE TRIGGER trg_payments_history
BEFORE UPDATE OR DELETE ON payments FOR EACH ROW
BEGIN
    IF DELETING THEN
        RAISE_APPLICATION_ERROR(-20113, 'Payment records must be voided, not deleted.');
    END IF;
    IF UPDATING THEN
        IF :NEW.appointment_id <> :OLD.appointment_id
           OR :NEW.amount <> :OLD.amount
           OR :NEW.payment_method <> :OLD.payment_method
           OR :NEW.paid_at <> :OLD.paid_at
           OR (:NEW.reference_no <> :OLD.reference_no)
           OR (:NEW.reference_no IS NULL AND :OLD.reference_no IS NOT NULL)
           OR (:NEW.reference_no IS NOT NULL AND :OLD.reference_no IS NULL) THEN
            RAISE_APPLICATION_ERROR(-20113,
                'Payment details are immutable. Void an incorrect payment.');
        END IF;
        IF :OLD.status = 'VOIDED' AND :NEW.status <> 'VOIDED' THEN
            RAISE_APPLICATION_ERROR(-20109, 'A voided payment cannot be restored.');
        END IF;
    END IF;
END;
/

CREATE OR REPLACE PACKAGE mc_api AUTHID DEFINER AS
    FUNCTION patient_age(p_patient_id NUMBER) RETURN NUMBER;
    FUNCTION appointment_balance(p_appointment_id NUMBER) RETURN NUMBER;
    PROCEDURE create_session(
        p_doctor_id NUMBER, p_clinic_id NUMBER,
        p_start_time TIMESTAMP, p_end_time TIMESTAMP,
        p_slot_minutes NUMBER, p_consultation_fee NUMBER,
        p_session_id OUT NUMBER);
    PROCEDURE book_appointment(
        p_patient_id NUMBER, p_session_id NUMBER, p_slot_no NUMBER,
        p_appointment_id OUT NUMBER);
    PROCEDURE confirm_appointment(p_appointment_id NUMBER);
    PROCEDURE cancel_appointment(p_appointment_id NUMBER, p_reason VARCHAR2);
    PROCEDURE record_consultation(
        p_appointment_id NUMBER, p_symptoms VARCHAR2, p_diagnosis VARCHAR2,
        p_clinical_notes CLOB, p_follow_up_date DATE,
        p_consultation_id OUT NUMBER);
    PROCEDURE save_prescription(
        p_consultation_id NUMBER, p_items_json CLOB, p_notes VARCHAR2,
        p_prescription_id OUT NUMBER);
    PROCEDURE record_payment(
        p_appointment_id NUMBER, p_amount NUMBER, p_payment_method VARCHAR2,
        p_reference_no VARCHAR2, p_payment_id OUT NUMBER);
    PROCEDURE void_payment(p_payment_id NUMBER);
    PROCEDURE mark_no_show(p_appointment_id NUMBER);
    PROCEDURE cancel_session(p_session_id NUMBER, p_reason VARCHAR2);
    PROCEDURE finish_session(p_session_id NUMBER);
END mc_api;
/

CREATE OR REPLACE PACKAGE BODY mc_api AS
    FUNCTION now_local RETURN TIMESTAMP IS
    BEGIN
        RETURN CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS TIMESTAMP);
    END;

    FUNCTION patient_age(p_patient_id NUMBER) RETURN NUMBER IS
        v_birth DATE;
    BEGIN
        SELECT date_of_birth INTO v_birth FROM patients
        WHERE patient_id = p_patient_id;
        RETURN TRUNC(MONTHS_BETWEEN(TRUNC(CAST(now_local AS DATE)), v_birth) / 12);
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20101, 'Patient not found.');
    END;

    FUNCTION appointment_balance(p_appointment_id NUMBER) RETURN NUMBER IS
        v_balance NUMBER;
    BEGIN
        SELECT balance_due INTO v_balance FROM v_appointment_balances
        WHERE appointment_id = p_appointment_id;
        RETURN v_balance;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20101, 'Appointment not found.');
    END;

    PROCEDURE create_session(
        p_doctor_id NUMBER, p_clinic_id NUMBER,
        p_start_time TIMESTAMP, p_end_time TIMESTAMP,
        p_slot_minutes NUMBER, p_consultation_fee NUMBER,
        p_session_id OUT NUMBER) IS
        v_active CHAR(1);
        v_count PLS_INTEGER;
        v_start_whole TIMESTAMP(0);
        v_end_whole TIMESTAMP(0);
    BEGIN
        SAVEPOINT mc_create_session;
        p_session_id := NULL;
        v_start_whole := p_start_time;
        v_end_whole := p_end_time;
        IF p_start_time IS NULL OR p_end_time IS NULL
           OR p_start_time <> v_start_whole
           OR p_end_time <> v_end_whole
           OR p_end_time <= p_start_time
           OR p_end_time > p_start_time + INTERVAL '1' DAY
           OR p_slot_minutes IS NULL OR p_slot_minutes <> TRUNC(p_slot_minutes)
           OR p_slot_minutes NOT BETWEEN 5 AND 120
           OR p_start_time + NUMTODSINTERVAL(p_slot_minutes,'MINUTE') > p_end_time
           OR p_consultation_fee IS NULL OR p_consultation_fee < 0
           OR p_consultation_fee <> ROUND(p_consultation_fee,2)
           OR p_consultation_fee > 99999999.99 THEN
            RAISE_APPLICATION_ERROR(-20103,
                'Invalid session times, slot length or fee. Use whole-second timestamps.');
        END IF;
        -- The doctor row serializes session creation across all clinics.
        SELECT active_flag INTO v_active FROM doctors
        WHERE doctor_id = p_doctor_id FOR UPDATE;
        IF v_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20102, 'Doctor is inactive.');
        END IF;
        SELECT active_flag INTO v_active FROM clinics
        WHERE clinic_id = p_clinic_id FOR UPDATE;
        IF v_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20102, 'Clinic is inactive.');
        END IF;
        SELECT COUNT(*) INTO v_count FROM doctor_sessions
        WHERE doctor_id = p_doctor_id AND status <> 'CANCELLED'
          AND start_time < p_end_time AND end_time > p_start_time;
        IF v_count > 0 THEN
            RAISE_APPLICATION_ERROR(-20104, 'Doctor already has an overlapping session.');
        END IF;
        INSERT INTO doctor_sessions(
            doctor_id,clinic_id,start_time,end_time,slot_minutes,consultation_fee)
        VALUES(p_doctor_id,p_clinic_id,p_start_time,p_end_time,
               p_slot_minutes,p_consultation_fee)
        RETURNING session_id INTO p_session_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_create_session;
            RAISE_APPLICATION_ERROR(-20101, 'Doctor or clinic not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_create_session;
            RAISE;
    END;

    PROCEDURE book_appointment(
        p_patient_id NUMBER, p_session_id NUMBER, p_slot_no NUMBER,
        p_appointment_id OUT NUMBER) IS
        v_s doctor_sessions%ROWTYPE;
        v_active CHAR(1);
        v_start TIMESTAMP;
        v_end TIMESTAMP;
        v_count PLS_INTEGER;
        v_now TIMESTAMP := now_local;
    BEGIN
        SAVEPOINT mc_book;
        p_appointment_id := NULL;
        IF p_slot_no IS NULL OR p_slot_no < 1 OR p_slot_no > 9999
           OR p_slot_no <> TRUNC(p_slot_no) THEN
            RAISE_APPLICATION_ERROR(-20106, 'Slot number must be a positive integer.');
        END IF;
        -- Locking the patient serializes bookings across different doctors.
        SELECT active_flag INTO v_active FROM patients
        WHERE patient_id = p_patient_id FOR UPDATE;
        IF v_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20102, 'Patient is inactive.');
        END IF;
        SELECT * INTO v_s FROM doctor_sessions
        WHERE session_id = p_session_id FOR UPDATE;
        IF v_s.status <> 'SCHEDULED' THEN
            RAISE_APPLICATION_ERROR(-20109, 'Session is not open for bookings.');
        END IF;
        SELECT active_flag INTO v_active FROM doctors
        WHERE doctor_id = v_s.doctor_id;
        IF v_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20102, 'Doctor is inactive.');
        END IF;
        SELECT active_flag INTO v_active FROM clinics
        WHERE clinic_id = v_s.clinic_id;
        IF v_active <> 'Y' THEN
            RAISE_APPLICATION_ERROR(-20102, 'Clinic is inactive.');
        END IF;
        v_start := v_s.start_time + NUMTODSINTERVAL(
                                           (p_slot_no - 1) * v_s.slot_minutes,'MINUTE');
        v_end := v_start + NUMTODSINTERVAL(v_s.slot_minutes,'MINUTE');
        IF v_end > v_s.end_time THEN
            RAISE_APPLICATION_ERROR(-20106, 'Slot is outside the session.');
        END IF;
        IF v_start <= v_now THEN
            RAISE_APPLICATION_ERROR(-20105, 'New appointments must be in the future.');
        END IF;
        SELECT COUNT(*) INTO v_count FROM v_appointment_details
        WHERE patient_id = p_patient_id AND status <> 'CANCELLED'
          AND appointment_start < v_end AND appointment_end > v_start;
        IF v_count > 0 THEN
            RAISE_APPLICATION_ERROR(-20107, 'Patient already has an overlapping appointment.');
        END IF;
        INSERT INTO appointments(session_id,patient_id,slot_no,agreed_fee,booked_at)
        VALUES(p_session_id,p_patient_id,p_slot_no,v_s.consultation_fee,v_now)
        RETURNING appointment_id INTO p_appointment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_book;
            RAISE_APPLICATION_ERROR(-20101, 'Patient, session, doctor or clinic not found.');
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK TO mc_book;
            RAISE_APPLICATION_ERROR(-20108, 'Slot is taken or patient already booked this session.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_book;
            RAISE;
    END;

    PROCEDURE confirm_appointment(p_appointment_id NUMBER) IS
        v_a appointments%ROWTYPE;
    BEGIN
        SAVEPOINT mc_confirm;
        SELECT * INTO v_a FROM appointments
        WHERE appointment_id = p_appointment_id FOR UPDATE;
        IF v_a.status <> 'BOOKED' THEN
            RAISE_APPLICATION_ERROR(-20109, 'Only a booked appointment can be confirmed.');
        END IF;
        UPDATE appointments SET status = 'CONFIRMED'
        WHERE appointment_id = p_appointment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_confirm;
            RAISE_APPLICATION_ERROR(-20101, 'Appointment not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_confirm;
            RAISE;
    END;

    PROCEDURE cancel_appointment(p_appointment_id NUMBER, p_reason VARCHAR2) IS
        v_a appointments%ROWTYPE;
        v_paid NUMBER;
        v_now TIMESTAMP := now_local;
    BEGIN
        SAVEPOINT mc_cancel;
        SELECT * INTO v_a FROM appointments
        WHERE appointment_id = p_appointment_id FOR UPDATE;
        IF v_a.status NOT IN ('BOOKED','CONFIRMED') THEN
            RAISE_APPLICATION_ERROR(-20109, 'Only an active booking can be cancelled.');
        END IF;
        IF TRIM(p_reason) IS NULL THEN
            RAISE_APPLICATION_ERROR(-20115, 'A cancellation reason is required.');
        END IF;
        SELECT NVL(SUM(amount),0) INTO v_paid FROM payments
        WHERE appointment_id = p_appointment_id AND status = 'COMPLETED';
        IF v_paid > 0 THEN
            RAISE_APPLICATION_ERROR(-20111,
                'Resolve recorded payments before cancellation. Refunds are not implemented.');
        END IF;
        UPDATE appointments
        SET status = 'CANCELLED', cancelled_at = v_now,
            cancellation_reason = TRIM(p_reason)
        WHERE appointment_id = p_appointment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_cancel;
            RAISE_APPLICATION_ERROR(-20101, 'Appointment not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_cancel;
            RAISE;
    END;

    PROCEDURE record_consultation(
        p_appointment_id NUMBER, p_symptoms VARCHAR2, p_diagnosis VARCHAR2,
        p_clinical_notes CLOB, p_follow_up_date DATE,
        p_consultation_id OUT NUMBER) IS
        v_a appointments%ROWTYPE;
        v_start TIMESTAMP;
        v_session_status doctor_sessions.status%TYPE;
        v_now TIMESTAMP := now_local;
    BEGIN
        SAVEPOINT mc_consult;
        p_consultation_id := NULL;
        SELECT * INTO v_a FROM appointments
        WHERE appointment_id = p_appointment_id FOR UPDATE;
        IF v_a.status NOT IN ('BOOKED','CONFIRMED') THEN
            RAISE_APPLICATION_ERROR(-20109, 'Appointment is not awaiting consultation.');
        END IF;
        SELECT appointment_start INTO v_start FROM v_appointment_details
        WHERE appointment_id = p_appointment_id;
        SELECT status INTO v_session_status FROM doctor_sessions
        WHERE session_id = v_a.session_id;
        IF v_start > v_now OR v_session_status = 'CANCELLED' THEN
            RAISE_APPLICATION_ERROR(-20109, 'Consultation cannot precede the slot or use a cancelled session.');
        END IF;
        IF TRIM(p_diagnosis) IS NULL THEN
            RAISE_APPLICATION_ERROR(-20115, 'Diagnosis is required.');
        END IF;
        IF p_follow_up_date IS NOT NULL
           AND TRUNC(p_follow_up_date) < TRUNC(CAST(v_now AS DATE)) THEN
            RAISE_APPLICATION_ERROR(-20103, 'Follow-up date cannot be in the past.');
        END IF;
        INSERT INTO consultations(appointment_id,consulted_at,symptoms,diagnosis,
                                  clinical_notes,follow_up_date)
        VALUES(p_appointment_id,v_now,TRIM(p_symptoms),TRIM(p_diagnosis),
               p_clinical_notes,TRUNC(p_follow_up_date))
        RETURNING consultation_id INTO p_consultation_id;
        UPDATE appointments SET status = 'COMPLETED'
        WHERE appointment_id = p_appointment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_consult;
            RAISE_APPLICATION_ERROR(-20101, 'Appointment or session not found.');
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK TO mc_consult;
            RAISE_APPLICATION_ERROR(-20109, 'Appointment already has a consultation.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_consult;
            RAISE;
    END;

    PROCEDURE save_prescription(
        p_consultation_id NUMBER, p_items_json CLOB, p_notes VARCHAR2,
        p_prescription_id OUT NUMBER) IS
        v_id NUMBER;
        v_active CHAR(1);
        v_items JSON_ARRAY_T;
        v_element JSON_ELEMENT_T;
        v_item JSON_OBJECT_T;
        v_medicine_id NUMBER;
        v_dosage VARCHAR2(32767);
        v_frequency VARCHAR2(32767);
        v_duration_days NUMBER;
        v_instructions VARCHAR2(32767);
        v_item_count PLS_INTEGER := 0;
        v_now TIMESTAMP := now_local;
    BEGIN
        SAVEPOINT mc_prescribe;
        p_prescription_id := NULL;
        SELECT consultation_id INTO v_id FROM consultations
        WHERE consultation_id = p_consultation_id FOR UPDATE;
        BEGIN
            v_items := JSON_ARRAY_T.parse(p_items_json);
            IF v_items.get_size() = 0 OR v_items.get_size() > 999 THEN
                RAISE_APPLICATION_ERROR(-20112, 'Provide between 1 and 999 prescription items.');
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE_APPLICATION_ERROR(-20112, 'Prescription items must be a non-empty JSON array.');
        END;
        INSERT INTO prescriptions(consultation_id,issued_at,notes)
        VALUES(p_consultation_id,v_now,TRIM(p_notes))
        RETURNING prescription_id INTO p_prescription_id;
        -- JSON array indexes are zero-based; prescription line numbers start at 1.
        FOR i IN 0 .. v_items.get_size() - 1 LOOP
            BEGIN
                v_element := v_items.get(i);
                IF v_element IS NULL OR NOT v_element.is_object() THEN
                    RAISE_APPLICATION_ERROR(-20112, 'Each prescription item must be an object.');
                END IF;
                v_item := TREAT(v_element AS JSON_OBJECT_T);
                v_item.on_error(1);
                v_medicine_id := v_item.get_number('medicine_id');
                v_dosage := TRIM(v_item.get_string('dosage'));
                v_frequency := TRIM(v_item.get_string('frequency'));
                v_duration_days := v_item.get_number('duration_days');
                v_instructions := NULL;
                IF v_item.has('instructions') THEN
                    v_instructions := TRIM(v_item.get_string('instructions'));
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE_APPLICATION_ERROR(-20112,
                        'Invalid prescription JSON item or required field type.');
            END;
            IF v_medicine_id IS NULL OR v_medicine_id <> TRUNC(v_medicine_id)
               OR v_dosage IS NULL OR LENGTH(v_dosage) > 100
               OR v_frequency IS NULL OR LENGTH(v_frequency) > 100
               OR v_duration_days IS NULL
               OR v_duration_days <> TRUNC(v_duration_days)
               OR v_duration_days NOT BETWEEN 1 AND 365
               OR LENGTH(v_instructions) > 1000 THEN
                RAISE_APPLICATION_ERROR(-20112, 'Invalid prescription item.');
            END IF;
            SELECT active_flag INTO v_active FROM medicines
            WHERE medicine_id = v_medicine_id;
            IF v_active <> 'Y' THEN
                RAISE_APPLICATION_ERROR(-20102, 'A selected medicine is inactive.');
            END IF;
            INSERT INTO prescription_items(prescription_id,line_no,medicine_id,
                                           dosage,frequency,duration_days,instructions)
            VALUES(p_prescription_id,i + 1,v_medicine_id,v_dosage,
                   v_frequency,v_duration_days,v_instructions);
            v_item_count := v_item_count + 1;
        END LOOP;
        IF v_item_count = 0 THEN
            RAISE_APPLICATION_ERROR(-20112, 'A prescription needs at least one item.');
        END IF;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_prescribe;
            RAISE_APPLICATION_ERROR(-20101, 'Consultation or medicine not found.');
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK TO mc_prescribe;
            RAISE_APPLICATION_ERROR(-20109, 'Consultation already has a prescription.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_prescribe;
            RAISE;
    END;

    PROCEDURE record_payment(
        p_appointment_id NUMBER, p_amount NUMBER, p_payment_method VARCHAR2,
        p_reference_no VARCHAR2, p_payment_id OUT NUMBER) IS
        v_status appointments.status%TYPE;
        v_method VARCHAR2(32767);
        v_now TIMESTAMP := now_local;
    BEGIN
        SAVEPOINT mc_pay;
        p_payment_id := NULL;
        v_method := UPPER(TRIM(p_payment_method));
        -- All payment changes take this same parent lock before calculating totals.
        SELECT status INTO v_status FROM appointments
        WHERE appointment_id = p_appointment_id FOR UPDATE;
        IF v_status = 'CANCELLED' THEN
            RAISE_APPLICATION_ERROR(-20109, 'Cancelled appointments cannot receive payment.');
        END IF;
        IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount,2)
           OR p_amount > 99999999.99 OR v_method IS NULL
           OR v_method NOT IN ('CASH','CARD','BANK_TRANSFER') THEN
            RAISE_APPLICATION_ERROR(-20110, 'Invalid payment amount or method.');
        END IF;
        IF p_amount > appointment_balance(p_appointment_id) THEN
            RAISE_APPLICATION_ERROR(-20110, 'Payment exceeds the outstanding balance.');
        END IF;
        INSERT INTO payments(appointment_id,amount,payment_method,paid_at,reference_no)
        VALUES(p_appointment_id,p_amount,v_method,v_now,TRIM(p_reference_no))
        RETURNING payment_id INTO p_payment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_pay;
            RAISE_APPLICATION_ERROR(-20101, 'Appointment not found.');
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK TO mc_pay;
            RAISE_APPLICATION_ERROR(-20110, 'Payment reference already exists.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_pay;
            RAISE;
    END;

    PROCEDURE void_payment(p_payment_id NUMBER) IS
        v_appt NUMBER;
        v_locked_appt NUMBER;
        v_status payments.status%TYPE;
    BEGIN
        SAVEPOINT mc_void;
        SELECT appointment_id INTO v_appt FROM payments
        WHERE payment_id = p_payment_id;
        SELECT appointment_id INTO v_locked_appt FROM appointments
        WHERE appointment_id = v_appt FOR UPDATE;
        SELECT status INTO v_status FROM payments
        WHERE payment_id = p_payment_id FOR UPDATE;
        IF v_status <> 'COMPLETED' THEN
            RAISE_APPLICATION_ERROR(-20109, 'Payment is already voided.');
        END IF;
        UPDATE payments SET status = 'VOIDED' WHERE payment_id = p_payment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_void;
            RAISE_APPLICATION_ERROR(-20101, 'Payment or appointment not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_void;
            RAISE;
    END;

    PROCEDURE mark_no_show(p_appointment_id NUMBER) IS
        v_a appointments%ROWTYPE;
        v_end TIMESTAMP;
    BEGIN
        SAVEPOINT mc_no_show;
        SELECT * INTO v_a FROM appointments
        WHERE appointment_id = p_appointment_id FOR UPDATE;
        SELECT appointment_end INTO v_end FROM v_appointment_details
        WHERE appointment_id = p_appointment_id;
        IF v_a.status NOT IN ('BOOKED','CONFIRMED') OR v_end > now_local THEN
            RAISE_APPLICATION_ERROR(-20109, 'Only an unattended, ended slot can be marked no-show.');
        END IF;
        UPDATE appointments SET status = 'NO_SHOW'
        WHERE appointment_id = p_appointment_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_no_show;
            RAISE_APPLICATION_ERROR(-20101, 'Appointment not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_no_show;
            RAISE;
    END;

    PROCEDURE cancel_session(p_session_id NUMBER, p_reason VARCHAR2) IS
        v_status doctor_sessions.status%TYPE;
        v_paid NUMBER;
        v_count PLS_INTEGER;
        v_now TIMESTAMP := now_local;
        CURSOR c_bookings IS
            SELECT appointment_id,status FROM appointments
            WHERE session_id = p_session_id
            ORDER BY appointment_id FOR UPDATE;
    BEGIN
        SAVEPOINT mc_cancel_session;
        SELECT status INTO v_status FROM doctor_sessions
        WHERE session_id = p_session_id FOR UPDATE;
        IF v_status <> 'SCHEDULED' OR TRIM(p_reason) IS NULL THEN
            RAISE_APPLICATION_ERROR(-20109, 'Provide a reason for cancelling a scheduled session.');
        END IF;
        -- Explicit cursor demonstrates multi-row processing. All changes roll
        -- back together if any booking has already been consulted or paid.
        FOR r IN c_bookings LOOP
            IF r.status IN ('COMPLETED','NO_SHOW') THEN
                RAISE_APPLICATION_ERROR(-20109, 'Session already contains completed history.');
            END IF;
            SELECT NVL(SUM(amount),0) INTO v_paid FROM payments
            WHERE appointment_id = r.appointment_id AND status = 'COMPLETED';
            SELECT COUNT(*) INTO v_count FROM consultations
            WHERE appointment_id = r.appointment_id;
            IF v_paid > 0 OR v_count > 0 THEN
                RAISE_APPLICATION_ERROR(-20111, 'Resolve payments/consultations before cancelling a session.');
            END IF;
            IF r.status IN ('BOOKED','CONFIRMED') THEN
                UPDATE appointments
                SET status = 'CANCELLED', cancelled_at = v_now,
                    cancellation_reason = TRIM(p_reason)
                WHERE CURRENT OF c_bookings;
            END IF;
        END LOOP;
        UPDATE doctor_sessions SET status = 'CANCELLED'
        WHERE session_id = p_session_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_cancel_session;
            RAISE_APPLICATION_ERROR(-20101, 'Session not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_cancel_session;
            RAISE;
    END;

    PROCEDURE finish_session(p_session_id NUMBER) IS
        v_s doctor_sessions%ROWTYPE;
        v_count PLS_INTEGER;
    BEGIN
        SAVEPOINT mc_finish;
        SELECT * INTO v_s FROM doctor_sessions
        WHERE session_id = p_session_id FOR UPDATE;
        IF v_s.status <> 'SCHEDULED' OR v_s.end_time > now_local THEN
            RAISE_APPLICATION_ERROR(-20109, 'Only an ended scheduled session can be completed.');
        END IF;
        -- Lock existing bookings in the same order as cancel_session.
        FOR r IN (SELECT appointment_id FROM appointments
                  WHERE session_id = p_session_id
                  ORDER BY appointment_id FOR UPDATE) LOOP
            NULL;
        END LOOP;
        SELECT COUNT(*) INTO v_count FROM appointments
        WHERE session_id = p_session_id AND status IN ('BOOKED','CONFIRMED');
        IF v_count > 0 THEN
            RAISE_APPLICATION_ERROR(-20109, 'Resolve every pending appointment first.');
        END IF;
        UPDATE doctor_sessions SET status = 'COMPLETED'
        WHERE session_id = p_session_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            ROLLBACK TO mc_finish;
            RAISE_APPLICATION_ERROR(-20101, 'Session not found.');
        WHEN OTHERS THEN
            ROLLBACK TO mc_finish;
            RAISE;
    END;
END mc_api;
/

CREATE OR REPLACE PACKAGE mc_reports AUTHID DEFINER AS
    -- Date ranges are inclusive of both calendar dates (clinic-local time).
    PROCEDURE appointment_summary(p_from DATE, p_to DATE, p_rows OUT SYS_REFCURSOR);
    PROCEDURE doctor_workload(p_from DATE, p_to DATE, p_rows OUT SYS_REFCURSOR);
    PROCEDURE clinic_revenue(p_from DATE, p_to DATE, p_rows OUT SYS_REFCURSOR);
    PROCEDURE outstanding_balances(p_rows OUT SYS_REFCURSOR);
    PROCEDURE patient_history(p_patient_id NUMBER, p_rows OUT SYS_REFCURSOR);
END mc_reports;
/

CREATE OR REPLACE PACKAGE BODY mc_reports AS
    PROCEDURE validate_dates(p_from DATE, p_to DATE) IS
    BEGIN
        IF p_from IS NULL OR p_to IS NULL OR TRUNC(p_from) > TRUNC(p_to) THEN
            RAISE_APPLICATION_ERROR(-20116, 'Provide a valid inclusive date range.');
        END IF;
    END;

    PROCEDURE appointment_summary(p_from DATE, p_to DATE, p_rows OUT SYS_REFCURSOR) IS
    BEGIN
        validate_dates(p_from,p_to);
        OPEN p_rows FOR
            SELECT TRUNC(CAST(appointment_start AS DATE)) AS appointment_date,
                   clinic_id,clinic_name,status,COUNT(*) AS appointment_count
            FROM v_appointment_details
            WHERE appointment_start >= CAST(TRUNC(p_from) AS TIMESTAMP)
              AND appointment_start < CAST(TRUNC(p_to) + 1 AS TIMESTAMP)
            GROUP BY TRUNC(CAST(appointment_start AS DATE)),clinic_id,clinic_name,status
            ORDER BY appointment_date,clinic_name,status;
    END;

    PROCEDURE doctor_workload(p_from DATE, p_to DATE, p_rows OUT SYS_REFCURSOR) IS
    BEGIN
        validate_dates(p_from,p_to);
        OPEN p_rows FOR
            SELECT doctor_id,doctor_name,COUNT(*) AS total_bookings,
                   SUM(CASE WHEN status IN ('BOOKED','CONFIRMED') THEN 1 ELSE 0 END) AS pending,
                   SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
                   SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                   SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) AS no_shows
            FROM v_appointment_details
            WHERE appointment_start >= CAST(TRUNC(p_from) AS TIMESTAMP)
              AND appointment_start < CAST(TRUNC(p_to) + 1 AS TIMESTAMP)
            GROUP BY doctor_id,doctor_name ORDER BY doctor_name;
    END;

    PROCEDURE clinic_revenue(p_from DATE, p_to DATE, p_rows OUT SYS_REFCURSOR) IS
    BEGIN
        validate_dates(p_from,p_to);
        OPEN p_rows FOR
            SELECT d.clinic_id,d.clinic_name,COUNT(p.payment_id) AS payment_count,
                   SUM(p.amount) AS collected_lkr
            FROM payments p
            JOIN v_appointment_details d ON d.appointment_id = p.appointment_id
            WHERE p.status = 'COMPLETED'
              AND p.paid_at >= CAST(TRUNC(p_from) AS TIMESTAMP)
              AND p.paid_at < CAST(TRUNC(p_to) + 1 AS TIMESTAMP)
            GROUP BY d.clinic_id,d.clinic_name ORDER BY d.clinic_name;
    END;

    PROCEDURE outstanding_balances(p_rows OUT SYS_REFCURSOR) IS
    BEGIN
        OPEN p_rows FOR
            SELECT d.appointment_id,d.patient_id,d.patient_name,d.doctor_name,
                   d.clinic_name,d.appointment_start,d.status,b.agreed_fee,
                   b.paid_amount,b.balance_due
            FROM v_appointment_details d
            JOIN v_appointment_balances b ON b.appointment_id = d.appointment_id
            WHERE b.status <> 'CANCELLED' AND b.balance_due > 0
            ORDER BY d.appointment_start,d.appointment_id;
    END;

    PROCEDURE patient_history(p_patient_id NUMBER, p_rows OUT SYS_REFCURSOR) IS
        v_count PLS_INTEGER;
    BEGIN
        SELECT COUNT(*) INTO v_count FROM patients WHERE patient_id = p_patient_id;
        IF v_count = 0 THEN
            RAISE_APPLICATION_ERROR(-20101, 'Patient not found.');
        END IF;
        OPEN p_rows FOR
            SELECT d.appointment_id,d.patient_id,d.patient_name,d.appointment_start,
                   d.doctor_name,d.clinic_name,c.consultation_id,c.consulted_at,
                   c.symptoms,c.diagnosis,c.follow_up_date,
                   pr.prescription_id,pr.issued_at,pr.notes AS prescription_notes,
                   pi.line_no,m.medicine_name,m.strength,m.dosage_form,
                   pi.dosage,pi.frequency,pi.duration_days,pi.instructions
            FROM v_appointment_details d
            JOIN consultations c ON c.appointment_id = d.appointment_id
            LEFT JOIN prescriptions pr ON pr.consultation_id = c.consultation_id
            LEFT JOIN prescription_items pi ON pi.prescription_id = pr.prescription_id
            LEFT JOIN medicines m ON m.medicine_id = pi.medicine_id
            WHERE d.patient_id = p_patient_id
            ORDER BY d.appointment_start DESC,d.appointment_id,pi.line_no;
    END;
END mc_reports;
/

PROMPT Checking compilation. Any compiler errors are printed below.
COLUMN name FORMAT A30
COLUMN type FORMAT A20
COLUMN text FORMAT A100
SELECT name,type,line,position,text FROM user_errors
WHERE name IN ('MC_API','MC_REPORTS','TRG_PATIENTS_VALIDATE',
               'TRG_DOCTORS_VALIDATE','TRG_SESSIONS_HISTORY',
               'TRG_APPOINTMENTS_HISTORY','TRG_PAYMENTS_HISTORY')
ORDER BY name,type,sequence;

DECLARE
    v_errors PLS_INTEGER;
    v_invalid PLS_INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_errors FROM user_errors
    WHERE attribute = 'ERROR' AND name IN ('MC_API','MC_REPORTS','TRG_PATIENTS_VALIDATE',
                   'TRG_DOCTORS_VALIDATE','TRG_SESSIONS_HISTORY',
                   'TRG_APPOINTMENTS_HISTORY','TRG_PAYMENTS_HISTORY');
    SELECT COUNT(*) INTO v_invalid FROM user_objects
    WHERE object_name IN ('MC_API','MC_REPORTS','TRG_PATIENTS_VALIDATE',
                          'TRG_DOCTORS_VALIDATE','TRG_SESSIONS_HISTORY',
                          'TRG_APPOINTMENTS_HISTORY','TRG_PAYMENTS_HISTORY',
                          'V_APPOINTMENT_DETAILS','V_APPOINTMENT_BALANCES')
      AND status <> 'VALID';
    IF v_errors > 0 OR v_invalid > 0 THEN
        RAISE_APPLICATION_ERROR(-20199, 'Compilation failed. Stop and share the compiler errors.');
    END IF;
    DBMS_OUTPUT.PUT_LINE('Stage 2 logic installed: 2 packages, 5 triggers, 2 views.');
END;
/
WHENEVER SQLERROR CONTINUE NONE
WHENEVER OSERROR CONTINUE NONE
