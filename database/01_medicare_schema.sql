-- MediCare Appointment Management System
-- Stage 1: relational schema for Oracle AI Database 26ai Free.
-- Run once, connected as MEDICARE to FREEPDB1.
-- This script creates 12 tables and their constraints/indexes.
-- It does not delete existing tables, create users, or contain passwords.
--
-- Model and relationships:
--   DOCTORS M:N SPECIALIZATIONS, through DOCTOR_SPECIALIZATIONS.
--   Each DOCTOR_SESSION belongs to one DOCTOR and one CLINIC.
--   Each APPOINTMENT belongs to one PATIENT and one DOCTOR_SESSION.
--   An appointment has zero or one CONSULTATION and zero or many PAYMENTS.
--   A consultation has zero or one PRESCRIPTION.
--   A prescription has one or more PRESCRIPTION_ITEMS when finalized.
--   Each prescription item references one MEDICINE.
--
-- Assumptions for this coursework implementation:
--   All fees and payments are in Sri Lankan rupees (LKR).
--   Session timestamps use clinic-local Sri Lanka time.
--   slot_no is 1-based, with a fixed slot_minutes per session.
--   Slot start = start_time + (slot_no - 1) * slot_minutes.
--   Slot end   = start_time + slot_no * slot_minutes.
--   appointments.agreed_fee preserves the fee at booking time.
--   Multiple payments per appointment allow installments.
--   Completed/no-show appointments retain their slots; cancelled ones release them.
--   A patient may have at most one non-cancelled appointment in a session.
--   Stored business records are retained; foreign keys prevent deleting parents
--   while dependent records exist. Master records can be marked inactive.
--
-- PL/SQL to be added in the next stage must enforce cross-row/table rules:
--   * No overlapping sessions for the same doctor, even across clinics.
--   * Every appointment slot fits completely inside its session.
--   * No overlapping active appointments for the same patient.
--   * Only active doctors/clinics/patients can participate in new bookings.
--   * Sessions with bookings cannot have their doctor, clinic, times or slot
--     length changed; fee changes affect future bookings only.
--   * Valid appointment/session state transitions and consultation ownership.
--   * One or more items before a prescription is finalized.
--   * Completed payments cannot exceed the appointment's agreed fee.
--   * Cancellation/payment-void rules preserve consistent financial history.
-- These are not claimed to be enforced by this DDL script alone.
-- Concurrent business operations will lock the relevant doctor/patient/
-- appointment rows before checking and changing dependent records.
--
-- Planned PL/SQL reports:
--   1. Appointment summary by date, clinic and appointment status.
--   2. Doctor workload by date range.
--   3. Collected revenue by clinic and payment date range.
--   4. Outstanding balances by appointment/patient.
--   5. Patient consultation and prescription history.

SET DEFINE OFF
SET SQLBLANKLINES ON
SET SERVEROUTPUT ON
SET LINESIZE 160
SET PAGESIZE 100
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

PROMPT Checking the connected account and pluggable database...

BEGIN
    IF SYS_CONTEXT('USERENV', 'SESSION_USER') <> 'MEDICARE'
       OR SYS_CONTEXT('USERENV', 'CON_NAME') <> 'FREEPDB1' THEN
        RAISE_APPLICATION_ERROR(
            -20001,
            'Connect as MEDICARE to FREEPDB1 before running this script.'
        );
    END IF;
END;
/

PROMPT Creating master tables...

CREATE TABLE specializations (
    specialization_id NUMBER GENERATED ALWAYS AS IDENTITY,
    specialization_name VARCHAR2(100 CHAR) NOT NULL,
    description VARCHAR2(500 CHAR),
    CONSTRAINT pk_specializations PRIMARY KEY (specialization_id),
    CONSTRAINT uq_specializations_name UNIQUE (specialization_name)
);

CREATE TABLE doctors (
    doctor_id NUMBER GENERATED ALWAYS AS IDENTITY,
    registration_no VARCHAR2(30 CHAR) NOT NULL,
    first_name VARCHAR2(80 CHAR) NOT NULL,
    last_name VARCHAR2(80 CHAR) NOT NULL,
    phone VARCHAR2(30 CHAR) NOT NULL,
    email VARCHAR2(254 CHAR),
    active_flag CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pk_doctors PRIMARY KEY (doctor_id),
    CONSTRAINT uq_doctors_reg_no UNIQUE (registration_no),
    CONSTRAINT ck_doctors_active CHECK (active_flag IN ('Y', 'N'))
);

CREATE TABLE doctor_specializations (
    doctor_id NUMBER NOT NULL,
    specialization_id NUMBER NOT NULL,
    CONSTRAINT pk_doctor_specializations
        PRIMARY KEY (doctor_id, specialization_id),
    CONSTRAINT fk_doc_spec_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors (doctor_id),
    CONSTRAINT fk_doc_spec_spec
        FOREIGN KEY (specialization_id)
        REFERENCES specializations (specialization_id)
);

CREATE TABLE patients (
    patient_id NUMBER GENERATED ALWAYS AS IDENTITY,
    first_name VARCHAR2(80 CHAR) NOT NULL,
    last_name VARCHAR2(80 CHAR) NOT NULL,
    date_of_birth DATE NOT NULL,
    gender VARCHAR2(12 CHAR) DEFAULT 'UNSPECIFIED' NOT NULL,
    phone VARCHAR2(30 CHAR) NOT NULL,
    email VARCHAR2(254 CHAR),
    address VARCHAR2(500 CHAR),
    active_flag CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pk_patients PRIMARY KEY (patient_id),
    CONSTRAINT ck_patients_gender
        CHECK (gender IN ('MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED')),
    CONSTRAINT ck_patients_active CHECK (active_flag IN ('Y', 'N'))
);

CREATE TABLE clinics (
    clinic_id NUMBER GENERATED ALWAYS AS IDENTITY,
    clinic_name VARCHAR2(150 CHAR) NOT NULL,
    facility_type VARCHAR2(10 CHAR) DEFAULT 'CLINIC' NOT NULL,
    address VARCHAR2(500 CHAR) NOT NULL,
    city VARCHAR2(80 CHAR) NOT NULL,
    phone VARCHAR2(30 CHAR) NOT NULL,
    active_flag CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
    CONSTRAINT pk_clinics PRIMARY KEY (clinic_id),
    CONSTRAINT ck_clinics_type CHECK (facility_type IN ('HOSPITAL', 'CLINIC')),
    CONSTRAINT ck_clinics_active CHECK (active_flag IN ('Y', 'N'))
);

CREATE TABLE medicines (
    medicine_id NUMBER GENERATED ALWAYS AS IDENTITY,
    medicine_name VARCHAR2(150 CHAR) NOT NULL,
    strength VARCHAR2(80 CHAR) NOT NULL,
    dosage_form VARCHAR2(50 CHAR) NOT NULL,
    active_flag CHAR(1 CHAR) DEFAULT 'Y' NOT NULL,
    CONSTRAINT pk_medicines PRIMARY KEY (medicine_id),
    CONSTRAINT uq_medicines_product
        UNIQUE (medicine_name, strength, dosage_form),
    CONSTRAINT ck_medicines_active CHECK (active_flag IN ('Y', 'N'))
);

PROMPT Creating scheduling tables...

CREATE TABLE doctor_sessions (
    session_id NUMBER GENERATED ALWAYS AS IDENTITY,
    doctor_id NUMBER NOT NULL,
    clinic_id NUMBER NOT NULL,
    start_time TIMESTAMP(0) NOT NULL,
    end_time TIMESTAMP(0) NOT NULL,
    slot_minutes NUMBER(3, 0) DEFAULT 15 NOT NULL,
    consultation_fee NUMBER(10, 2) NOT NULL,
    status VARCHAR2(12 CHAR) DEFAULT 'SCHEDULED' NOT NULL,
    CONSTRAINT pk_doctor_sessions PRIMARY KEY (session_id),
    CONSTRAINT fk_sessions_doctor
        FOREIGN KEY (doctor_id) REFERENCES doctors (doctor_id),
    CONSTRAINT fk_sessions_clinic
        FOREIGN KEY (clinic_id) REFERENCES clinics (clinic_id),
    CONSTRAINT ck_sessions_time CHECK (end_time > start_time),
    CONSTRAINT ck_sessions_slot CHECK (slot_minutes BETWEEN 5 AND 120),
    CONSTRAINT ck_sessions_fee CHECK (consultation_fee >= 0),
    CONSTRAINT ck_sessions_status
        CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED'))
);

CREATE TABLE appointments (
    appointment_id NUMBER GENERATED ALWAYS AS IDENTITY,
    session_id NUMBER NOT NULL,
    patient_id NUMBER NOT NULL,
    slot_no NUMBER(4, 0) NOT NULL,
    agreed_fee NUMBER(10, 2) NOT NULL,
    status VARCHAR2(12 CHAR) DEFAULT 'BOOKED' NOT NULL,
    booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cancelled_at TIMESTAMP,
    cancellation_reason VARCHAR2(500 CHAR),
    CONSTRAINT pk_appointments PRIMARY KEY (appointment_id),
    CONSTRAINT fk_appointments_session
        FOREIGN KEY (session_id) REFERENCES doctor_sessions (session_id),
    CONSTRAINT fk_appointments_patient
        FOREIGN KEY (patient_id) REFERENCES patients (patient_id),
    CONSTRAINT ck_appointments_slot CHECK (slot_no >= 1),
    CONSTRAINT ck_appointments_fee CHECK (agreed_fee >= 0),
    CONSTRAINT ck_appointments_status
        CHECK (status IN ('BOOKED', 'CONFIRMED', 'CANCELLED',
                          'COMPLETED', 'NO_SHOW')),
    CONSTRAINT ck_appointments_cancelled CHECK (
        (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
        OR (status <> 'CANCELLED' AND cancelled_at IS NULL)
    )
);

-- The two CASE expressions become NULL for cancelled appointments.
-- Oracle omits all-NULL entries from a normal B-tree index, so a cancelled
-- appointment releases its slot without deleting its historical record.
CREATE UNIQUE INDEX ux_appt_live_slot ON appointments (
    CASE WHEN status <> 'CANCELLED' THEN session_id END,
    CASE WHEN status <> 'CANCELLED' THEN slot_no END
);

CREATE UNIQUE INDEX ux_appt_live_patient ON appointments (
    CASE WHEN status <> 'CANCELLED' THEN session_id END,
    CASE WHEN status <> 'CANCELLED' THEN patient_id END
);

PROMPT Creating consultation, prescription and payment tables...

CREATE TABLE consultations (
    consultation_id NUMBER GENERATED ALWAYS AS IDENTITY,
    appointment_id NUMBER NOT NULL,
    consulted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    symptoms VARCHAR2(2000 CHAR),
    diagnosis VARCHAR2(2000 CHAR) NOT NULL,
    clinical_notes CLOB,
    follow_up_date DATE,
    CONSTRAINT pk_consultations PRIMARY KEY (consultation_id),
    CONSTRAINT uq_consultations_appointment UNIQUE (appointment_id),
    CONSTRAINT fk_consultations_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id)
);

CREATE TABLE prescriptions (
    prescription_id NUMBER GENERATED ALWAYS AS IDENTITY,
    consultation_id NUMBER NOT NULL,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes VARCHAR2(1000 CHAR),
    CONSTRAINT pk_prescriptions PRIMARY KEY (prescription_id),
    CONSTRAINT uq_prescriptions_consult UNIQUE (consultation_id),
    CONSTRAINT fk_prescriptions_consult
        FOREIGN KEY (consultation_id) REFERENCES consultations (consultation_id)
);

CREATE TABLE prescription_items (
    prescription_id NUMBER NOT NULL,
    line_no NUMBER(3, 0) NOT NULL,
    medicine_id NUMBER NOT NULL,
    dosage VARCHAR2(100 CHAR) NOT NULL,
    frequency VARCHAR2(100 CHAR) NOT NULL,
    duration_days NUMBER(3, 0) NOT NULL,
    instructions VARCHAR2(1000 CHAR),
    CONSTRAINT pk_prescription_items PRIMARY KEY (prescription_id, line_no),
    CONSTRAINT fk_presc_items_prescription
        FOREIGN KEY (prescription_id) REFERENCES prescriptions (prescription_id),
    CONSTRAINT fk_presc_items_medicine
        FOREIGN KEY (medicine_id) REFERENCES medicines (medicine_id),
    CONSTRAINT ck_presc_items_line CHECK (line_no >= 1),
    CONSTRAINT ck_presc_items_duration CHECK (duration_days BETWEEN 1 AND 365)
);

CREATE TABLE payments (
    payment_id NUMBER GENERATED ALWAYS AS IDENTITY,
    appointment_id NUMBER NOT NULL,
    amount NUMBER(10, 2) NOT NULL,
    payment_method VARCHAR2(15 CHAR) NOT NULL,
    status VARCHAR2(12 CHAR) DEFAULT 'COMPLETED' NOT NULL,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reference_no VARCHAR2(100 CHAR),
    CONSTRAINT pk_payments PRIMARY KEY (payment_id),
    CONSTRAINT fk_payments_appointment
        FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id),
    CONSTRAINT uq_payments_reference UNIQUE (reference_no),
    CONSTRAINT ck_payments_amount CHECK (amount > 0),
    CONSTRAINT ck_payments_method
        CHECK (payment_method IN ('CASH', 'CARD', 'BANK_TRANSFER')),
    CONSTRAINT ck_payments_status CHECK (status IN ('COMPLETED', 'VOIDED'))
);

PROMPT Creating search and foreign-key indexes...

CREATE INDEX ix_doc_spec_spec ON doctor_specializations (specialization_id);
CREATE INDEX ix_sessions_doctor ON doctor_sessions (doctor_id, start_time);
CREATE INDEX ix_sessions_clinic ON doctor_sessions (clinic_id, start_time);
CREATE INDEX ix_appts_session ON appointments (session_id);
CREATE INDEX ix_appts_patient ON appointments (patient_id, booked_at);
CREATE INDEX ix_presc_items_medicine ON prescription_items (medicine_id);
CREATE INDEX ix_payments_appt ON payments (appointment_id, status);

PROMPT Verifying the schema...

DECLARE
    v_table_count PLS_INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_table_count
    FROM user_tables
    WHERE table_name IN (
        'SPECIALIZATIONS', 'DOCTORS', 'DOCTOR_SPECIALIZATIONS',
        'PATIENTS', 'CLINICS', 'MEDICINES', 'DOCTOR_SESSIONS',
        'APPOINTMENTS', 'CONSULTATIONS', 'PRESCRIPTIONS',
        'PRESCRIPTION_ITEMS', 'PAYMENTS'
    );

    IF v_table_count <> 12 THEN
        RAISE_APPLICATION_ERROR(-20002, 'Expected 12 MediCare tables.');
    END IF;

    DBMS_OUTPUT.PUT_LINE('MediCare schema created: 12 tables.');
END;
/

COLUMN table_name FORMAT A30
SELECT table_name
FROM user_tables
WHERE table_name IN (
    'SPECIALIZATIONS', 'DOCTORS', 'DOCTOR_SPECIALIZATIONS',
    'PATIENTS', 'CLINICS', 'MEDICINES', 'DOCTOR_SESSIONS',
    'APPOINTMENTS', 'CONSULTATIONS', 'PRESCRIPTIONS',
    'PRESCRIPTION_ITEMS', 'PAYMENTS'
)
ORDER BY table_name;

PROMPT Stage 1 complete. Next: PL/SQL business logic and synthetic sample data.
PROMPT Do not rerun this creation script after it has succeeded.

-- Return to the normal interactive SQL*Plus error behaviour.
WHENEVER SQLERROR CONTINUE NONE
WHENEVER OSERROR CONTINUE NONE
