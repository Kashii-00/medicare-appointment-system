-- Fictional demonstration data only. Run ONCE on an empty MediCare schema.
-- Historical records are imported directly with historical timestamps;
-- future appointments/payments/cancellations use MC_API.
-- All money is LKR. All sample products/dosages are fictional placeholders.
SET DEFINE OFF
SET SQLBLANKLINES ON
SET SERVEROUTPUT ON
SET LINESIZE 180
SET PAGESIZE 100
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
ALTER SESSION SET TIME_ZONE = 'Asia/Colombo';

DECLARE
    TYPE t_ids IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
    v_specs t_ids;
    v_doctors t_ids;
    v_clinics t_ids;
    v_patients t_ids;
    v_medicines t_ids;
    v_spec_names SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST(
        'General Medicine','Cardiology','Dermatology','Paediatrics',
        'Neurology','Orthopaedics','ENT','Ophthalmology');
    v_doc_first SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST(
        'Nimal','Amaya','Kasun','Tharushi','Dilan','Nethmi');
    v_doc_last SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST(
        'Perera','Fernando','Silva','Jayasinghe','Senanayake','Wijesinghe');
    v_cities SYS.ODCIVARCHAR2LIST := SYS.ODCIVARCHAR2LIST(
        'Colombo','Kandy','Galle','Negombo');
    v_today DATE := TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS DATE));
    v_start TIMESTAMP;
    v_end TIMESTAMP;
    v_session NUMBER;
    v_appt NUMBER;
    v_consult NUMBER;
    v_prescription NUMBER;
    v_payment NUMBER;
    v_count NUMBER;
    v_doc PLS_INTEGER;
    v_patient PLS_INTEGER;
    v_fee NUMBER;
BEGIN
    IF SYS_CONTEXT('USERENV','SESSION_USER') <> 'MEDICARE'
       OR SYS_CONTEXT('USERENV','CON_NAME') <> 'FREEPDB1' THEN
        RAISE_APPLICATION_ERROR(-20200, 'Connect as MEDICARE to FREEPDB1.');
    END IF;
    SELECT SUM(n) INTO v_count FROM (
        SELECT COUNT(*) n FROM specializations UNION ALL
        SELECT COUNT(*) FROM doctors UNION ALL
        SELECT COUNT(*) FROM doctor_specializations UNION ALL
        SELECT COUNT(*) FROM patients UNION ALL
        SELECT COUNT(*) FROM clinics UNION ALL
        SELECT COUNT(*) FROM medicines UNION ALL
        SELECT COUNT(*) FROM doctor_sessions UNION ALL
        SELECT COUNT(*) FROM appointments UNION ALL
        SELECT COUNT(*) FROM consultations UNION ALL
        SELECT COUNT(*) FROM prescriptions UNION ALL
        SELECT COUNT(*) FROM prescription_items UNION ALL
        SELECT COUNT(*) FROM payments
    );
    IF v_count > 0 THEN
        RAISE_APPLICATION_ERROR(-20200,
            'Sample data requires empty tables. Existing data has not been changed.');
    END IF;

    FOR i IN 1..8 LOOP
        INSERT INTO specializations(specialization_name,description)
        VALUES(v_spec_names(i),'Fictional MediCare demonstration department')
        RETURNING specialization_id INTO v_specs(i);
    END LOOP;
    FOR i IN 1..6 LOOP
        INSERT INTO doctors(registration_no,first_name,last_name,phone,email)
        VALUES('DEMO-REG-' || TO_CHAR(i,'FM000'),v_doc_first(i),v_doc_last(i),
               '011000' || TO_CHAR(i,'FM0000'),
               'demo.doctor.' || i || '@example.invalid')
        RETURNING doctor_id INTO v_doctors(i);
        INSERT INTO doctor_specializations(doctor_id,specialization_id)
        VALUES(v_doctors(i),v_specs(i));
    END LOOP;
    INSERT INTO doctor_specializations VALUES(v_doctors(1),v_specs(7));
    INSERT INTO doctor_specializations VALUES(v_doctors(2),v_specs(8));
    FOR i IN 1..4 LOOP
        INSERT INTO clinics(clinic_name,facility_type,address,city,phone)
        VALUES('Demo ' || v_cities(i) || ' Medical Centre',
               CASE WHEN i = 1 THEN 'HOSPITAL' ELSE 'CLINIC' END,
               'Fictional demonstration address ' || i,v_cities(i),
               '011100' || TO_CHAR(i,'FM0000'))
        RETURNING clinic_id INTO v_clinics(i);
    END LOOP;
    FOR i IN 1..30 LOOP
        INSERT INTO patients(first_name,last_name,date_of_birth,gender,phone,email,address)
        VALUES('DemoPatient' || TO_CHAR(i,'FM00'),'Sample',
               ADD_MONTHS(v_today,-12 * (18 + MOD(i,48))) - i,
               CASE WHEN MOD(i,2) = 0 THEN 'FEMALE' ELSE 'MALE' END,
               '070000' || TO_CHAR(i,'FM0000'),
               'demo.patient.' || i || '@example.invalid',
               'Fictional patient address ' || i)
        RETURNING patient_id INTO v_patients(i);
    END LOOP;
    FOR i IN 1..6 LOOP
        INSERT INTO medicines(medicine_name,strength,dosage_form)
        VALUES('Demo Medicine ' || CHR(64+i),'Sample strength',
               CASE WHEN MOD(i,2) = 0 THEN 'LIQUID' ELSE 'TABLET' END)
        RETURNING medicine_id INTO v_medicines(i);
    END LOOP;

    -- Six ended sessions, with 24 completed consultations and six no-shows.
    FOR i IN 1..6 LOOP
        v_start := CAST(v_today - i AS TIMESTAMP) + INTERVAL '9' HOUR;
        v_end := v_start + INTERVAL '90' MINUTE;
        v_fee := 1500 + i * 250;
        mc_api.create_session(v_doctors(i),v_clinics(MOD(i-1,4)+1),
                             v_start,v_end,15,v_fee,v_session);
        FOR j IN 1..5 LOOP
            v_patient := (i-1)*5+j;
            INSERT INTO appointments(session_id,patient_id,slot_no,agreed_fee,status,booked_at)
            VALUES(v_session,v_patients(v_patient),j,v_fee,
                   CASE WHEN j <= 4 THEN 'COMPLETED' ELSE 'NO_SHOW' END,
                   v_start - INTERVAL '2' DAY)
            RETURNING appointment_id INTO v_appt;
            IF j <= 4 THEN
                INSERT INTO consultations(appointment_id,consulted_at,symptoms,
                    diagnosis,clinical_notes,follow_up_date)
                VALUES(v_appt,v_start + NUMTODSINTERVAL((j-1)*15+5,'MINUTE'),
                    'Fictional sample symptoms ' || j,
                    'Fictional demonstration diagnosis ' || j,
                    'Imported synthetic history. Not a real medical record.',v_today+14)
                RETURNING consultation_id INTO v_consult;
                INSERT INTO prescriptions(consultation_id,issued_at,notes)
                VALUES(v_consult,v_start + NUMTODSINTERVAL(j*15-2,'MINUTE'),
                       'Synthetic demonstration only; not medical instructions.')
                RETURNING prescription_id INTO v_prescription;
                FOR k IN 1..2 LOOP
                    INSERT INTO prescription_items(prescription_id,line_no,medicine_id,
                        dosage,frequency,duration_days,instructions)
                    VALUES(v_prescription,k,v_medicines(MOD(i+k-2,6)+1),
                        'Demo dosage','Demo frequency',3,
                        'Fictional data for software testing only.');
                END LOOP;
                IF j = 1 THEN
                    FOR k IN 1..2 LOOP
                        INSERT INTO payments(appointment_id,amount,payment_method,paid_at,reference_no)
                        VALUES(v_appt,v_fee/2,'CARD',
                            v_start + NUMTODSINTERVAL(j*15,'MINUTE'),
                            'DEMO-H-' || i || '-' || j || '-' || k);
                    END LOOP;
                ELSIF j IN (2,3) THEN
                    INSERT INTO payments(appointment_id,amount,payment_method,paid_at,reference_no)
                    VALUES(v_appt,CASE WHEN j=2 THEN v_fee ELSE v_fee/2 END,
                        'CASH',v_start + NUMTODSINTERVAL(j*15,'MINUTE'),
                        'DEMO-H-' || i || '-' || j);
                END IF;
            END IF;
        END LOOP;
        mc_api.finish_session(v_session);
    END LOOP;

    -- Twelve future sessions. Each has five live bookings and one cancelled
    -- booking whose slot was reused by another patient.
    FOR i IN 1..12 LOOP
        v_doc := MOD(i-1,6)+1;
        v_start := CAST(v_today + i + CASE WHEN i > 6 THEN 1 ELSE 0 END AS TIMESTAMP)
                   + INTERVAL '16' HOUR;
        v_end := v_start + INTERVAL '90' MINUTE;
        v_fee := 1800 + v_doc*250;
        mc_api.create_session(v_doctors(v_doc),v_clinics(MOD(i-1,4)+1),
                             v_start,v_end,15,v_fee,v_session);
        FOR j IN 1..4 LOOP
            v_patient := MOD((i-1)*5+j-1,30)+1;
            mc_api.book_appointment(v_patients(v_patient),v_session,j,v_appt);
            IF j IN (1,4) THEN
                mc_api.confirm_appointment(v_appt);
            END IF;
            IF j IN (1,2) THEN
                mc_api.record_payment(v_appt,
                    CASE WHEN j=1 THEN v_fee ELSE v_fee/2 END,
                    CASE WHEN j=1 THEN 'CARD' ELSE 'BANK_TRANSFER' END,
                    'DEMO-F-' || i || '-' || j,v_payment);
            ELSIF j=4 THEN
                mc_api.record_payment(v_appt,250,'CASH',
                                      'DEMO-VOID-' || i,v_payment);
                mc_api.void_payment(v_payment);
                mc_api.record_payment(v_appt,v_fee/2,'CASH',
                                      'DEMO-REPLACEMENT-' || i,v_payment);
            END IF;
        END LOOP;
        v_patient := MOD((i-1)*5+4,30)+1;
        mc_api.book_appointment(v_patients(v_patient),v_session,5,v_appt);
        mc_api.cancel_appointment(v_appt,'Synthetic example: patient changed plans.');
        v_patient := MOD((i-1)*5+5,30)+1;
        mc_api.book_appointment(v_patients(v_patient),v_session,5,v_appt);
        -- Existing appointments retain their original agreed_fee.
        UPDATE doctor_sessions SET consultation_fee = consultation_fee + 100
        WHERE session_id = v_session;
    END LOOP;
    COMMIT;
    DBMS_OUTPUT.PUT_LINE('Sample data committed: 102 appointments, 24 consultations.');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/

SELECT 'SPECIALIZATIONS' AS table_name,COUNT(*) AS row_count FROM specializations
UNION ALL SELECT 'DOCTORS',COUNT(*) FROM doctors
UNION ALL SELECT 'DOCTOR_SPECIALIZATIONS',COUNT(*) FROM doctor_specializations
UNION ALL SELECT 'CLINICS',COUNT(*) FROM clinics
UNION ALL SELECT 'PATIENTS',COUNT(*) FROM patients
UNION ALL SELECT 'MEDICINES',COUNT(*) FROM medicines
UNION ALL SELECT 'DOCTOR_SESSIONS',COUNT(*) FROM doctor_sessions
UNION ALL SELECT 'APPOINTMENTS',COUNT(*) FROM appointments
UNION ALL SELECT 'CONSULTATIONS',COUNT(*) FROM consultations
UNION ALL SELECT 'PRESCRIPTIONS',COUNT(*) FROM prescriptions
UNION ALL SELECT 'PRESCRIPTION_ITEMS',COUNT(*) FROM prescription_items
UNION ALL SELECT 'PAYMENTS',COUNT(*) FROM payments;

WHENEVER SQLERROR CONTINUE NONE
WHENEVER OSERROR CONTINUE NONE
