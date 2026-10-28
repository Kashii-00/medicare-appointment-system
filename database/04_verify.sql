-- Run after 02 and 03. Checks data invariants and business behaviour.
-- Test fixtures are rolled back; existing committed demo data is preserved.
-- Oracle identity counters may advance during rolled-back tests; gaps are normal.
SET DEFINE OFF
SET SQLBLANKLINES ON
SET SERVEROUTPUT ON
SET LINESIZE 180
SET PAGESIZE 100
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
ALTER SESSION SET TIME_ZONE = 'Asia/Colombo';

PROMPT Checking existing data invariants...
DECLARE
    v_count NUMBER;
    PROCEDURE zero_rows(p_count NUMBER, p_label VARCHAR2) IS
    BEGIN
        IF p_count <> 0 THEN
            RAISE_APPLICATION_ERROR(-20290,p_label || ': ' || p_count || ' invalid rows.');
        END IF;
        DBMS_OUTPUT.PUT_LINE('PASS: ' || p_label);
    END;
BEGIN
    SELECT COUNT(*) INTO v_count FROM user_objects
    WHERE object_name IN ('MC_API','MC_REPORTS','V_APPOINTMENT_DETAILS',
        'V_APPOINTMENT_BALANCES','TRG_PATIENTS_VALIDATE','TRG_DOCTORS_VALIDATE',
        'TRG_SESSIONS_HISTORY','TRG_APPOINTMENTS_HISTORY','TRG_PAYMENTS_HISTORY')
      AND status <> 'VALID';
    zero_rows(v_count,'Installed program objects are valid');
    SELECT COUNT(*) INTO v_count FROM v_appointment_balances WHERE balance_due < 0;
    zero_rows(v_count,'No appointment is overpaid');
    SELECT COUNT(*) INTO v_count FROM v_appointment_balances
    WHERE status='CANCELLED' AND paid_amount > 0;
    zero_rows(v_count,'Cancelled appointments have no unresolved payments');
    SELECT COUNT(*) INTO v_count FROM v_appointment_details
    WHERE appointment_start < session_start OR appointment_end > session_end;
    zero_rows(v_count,'All appointment slots fit their sessions');
    SELECT COUNT(*) INTO v_count FROM doctor_sessions a JOIN doctor_sessions b
      ON a.doctor_id=b.doctor_id AND a.session_id < b.session_id
     AND a.start_time < b.end_time AND a.end_time > b.start_time
    WHERE a.status <> 'CANCELLED' AND b.status <> 'CANCELLED';
    zero_rows(v_count,'No doctor has overlapping sessions');
    SELECT COUNT(*) INTO v_count FROM v_appointment_details a
    JOIN v_appointment_details b ON a.patient_id=b.patient_id
      AND a.appointment_id < b.appointment_id
      AND a.appointment_start < b.appointment_end
      AND a.appointment_end > b.appointment_start
    WHERE a.status <> 'CANCELLED' AND b.status <> 'CANCELLED';
    zero_rows(v_count,'No patient has overlapping appointments');
    SELECT COUNT(*) INTO v_count FROM prescriptions p
    WHERE NOT EXISTS(SELECT 1 FROM prescription_items i
                     WHERE i.prescription_id=p.prescription_id);
    zero_rows(v_count,'Every saved prescription has items');
    SELECT COUNT(*) INTO v_count FROM appointments a
    WHERE a.status='COMPLETED' AND NOT EXISTS(
        SELECT 1 FROM consultations c WHERE c.appointment_id=a.appointment_id);
    zero_rows(v_count,'Completed appointments have consultation records');
END;
/

PROMPT Running isolated business tests...
DECLARE
    v_doctor NUMBER;
    v_doctor2 NUMBER;
    v_clinic NUMBER;
    v_clinic2 NUMBER;
    v_patient NUMBER;
    v_patient2 NUMBER;
    v_patient3 NUMBER;
    v_inactive_patient NUMBER;
    v_medicine NUMBER;
    v_inactive_medicine NUMBER;
    v_session NUMBER;
    v_session2 NUMBER;
    v_past_session NUMBER;
    v_other_session NUMBER;
    v_appointment NUMBER;
    v_adjacent_appointment NUMBER;
    v_rebook NUMBER;
    v_past_appointment NUMBER;
    v_no_show NUMBER;
    v_other NUMBER;
    v_consultation NUMBER;
    v_prescription NUMBER;
    v_payment NUMBER;
    v_payment2 NUMBER;
    v_count NUMBER;
    v_number NUMBER;
    v_text VARCHAR2(254);
    v_status appointments.status%TYPE;
    v_json CLOB;
    v_rows SYS_REFCURSOR;
    v_passes PLS_INTEGER := 0;
    v_today DATE := TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS DATE));
    v_start TIMESTAMP;
    v_past TIMESTAMP;
    PROCEDURE check_true(p_ok BOOLEAN, p_label VARCHAR2) IS
    BEGIN
        IF p_ok IS NULL OR NOT p_ok THEN
            RAISE_APPLICATION_ERROR(-20299,'FAIL: ' || p_label);
        END IF;
        v_passes := v_passes+1;
        DBMS_OUTPUT.PUT_LINE('PASS: ' || p_label);
    END;
    PROCEDURE check_code(p_actual NUMBER,p_expected NUMBER,p_label VARCHAR2) IS
    BEGIN
        check_true(p_actual=p_expected,p_label || ' (error ' || p_actual || ')');
    END;
BEGIN
    SAVEPOINT mc_test_suite;
    INSERT INTO doctors(registration_no,first_name,last_name,phone,email)
    VALUES('  test-api-1  ','Test','DoctorOne','0110000001',' TEST.ONE@EXAMPLE.INVALID ')
    RETURNING doctor_id INTO v_doctor;
    INSERT INTO doctors(registration_no,first_name,last_name,phone)
    VALUES('TEST-API-2','Test','DoctorTwo','0110000002')
    RETURNING doctor_id INTO v_doctor2;
    INSERT INTO clinics(clinic_name,address,city,phone)
    VALUES('Test Clinic One','Test Address','Test City','0110000003')
    RETURNING clinic_id INTO v_clinic;
    INSERT INTO clinics(clinic_name,address,city,phone)
    VALUES('Test Clinic Two','Test Address','Test City','0110000004')
    RETURNING clinic_id INTO v_clinic2;
    INSERT INTO patients(first_name,last_name,date_of_birth,phone)
    VALUES('Test','PatientOne',ADD_MONTHS(v_today,-360),'0700000001')
    RETURNING patient_id INTO v_patient;
    INSERT INTO patients(first_name,last_name,date_of_birth,phone)
    VALUES('Test','PatientTwo',ADD_MONTHS(v_today,-300),'0700000002')
    RETURNING patient_id INTO v_patient2;
    INSERT INTO patients(first_name,last_name,date_of_birth,phone)
    VALUES('Test','PatientThree',ADD_MONTHS(v_today,-240),'0700000003')
    RETURNING patient_id INTO v_patient3;
    INSERT INTO patients(first_name,last_name,date_of_birth,phone,active_flag)
    VALUES('Test','InactivePatient',ADD_MONTHS(v_today,-240),'0700000004','N')
    RETURNING patient_id INTO v_inactive_patient;
    INSERT INTO medicines(medicine_name,strength,dosage_form)
    VALUES('Test Product One','Test strength','TEST')
    RETURNING medicine_id INTO v_medicine;
    INSERT INTO medicines(medicine_name,strength,dosage_form,active_flag)
    VALUES('Test Product Two','Test strength','TEST','N')
    RETURNING medicine_id INTO v_inactive_medicine;

    SELECT registration_no INTO v_text FROM doctors WHERE doctor_id=v_doctor;
    check_true(v_text='TEST-API-1','Doctor trigger normalizes registration numbers');
    SELECT email INTO v_text FROM doctors WHERE doctor_id=v_doctor;
    check_true(v_text='test.one@example.invalid','Doctor trigger normalizes email');
    check_true(mc_api.patient_age(v_patient)=30,'Patient age function');
    BEGIN
        UPDATE patients SET date_of_birth=v_today+1 WHERE patient_id=v_patient;
        check_true(FALSE,'Future birth date should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20114,'Future birth date is rejected by trigger');
    END;

    v_start := CAST(v_today+60 AS TIMESTAMP)+INTERVAL '9' HOUR;
    v_past := CAST(v_today-60 AS TIMESTAMP)+INTERVAL '9' HOUR;
    mc_api.create_session(v_doctor,v_clinic,v_start,v_start+INTERVAL '1' HOUR,
                         15,1000,v_session);
    mc_api.create_session(v_doctor2,v_clinic,v_start,v_start+INTERVAL '1' HOUR,
                         15,1000,v_session2);
    mc_api.create_session(v_doctor,v_clinic,v_past,v_past+INTERVAL '1' HOUR,
                         15,1000,v_past_session);
    BEGIN
        mc_api.create_session(v_doctor,v_clinic2,v_start+INTERVAL '30' MINUTE,
                             v_start+INTERVAL '90' MINUTE,15,1000,v_other_session);
        check_true(FALSE,'Overlapping doctor session should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20104,'Overlapping doctor sessions across clinics rejected');
    END;
    mc_api.create_session(v_doctor,v_clinic2,v_start+INTERVAL '1' HOUR,
                         v_start+INTERVAL '2' HOUR,15,1000,v_other_session);
    check_true(v_other_session IS NOT NULL,'Adjacent doctor sessions are allowed');

    mc_api.book_appointment(v_patient,v_session,1,v_appointment);
    check_true(v_appointment IS NOT NULL,'Future appointment can be booked');
    mc_api.confirm_appointment(v_appointment);
    SELECT status INTO v_status FROM appointments WHERE appointment_id=v_appointment;
    check_true(v_status='CONFIRMED','Booking can be confirmed');
    BEGIN
        mc_api.book_appointment(v_patient2,v_session,1,v_other);
        check_true(FALSE,'Duplicate slot should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20108,'Duplicate slot rejected');
    END;
    BEGIN
        mc_api.book_appointment(v_patient,v_session2,1,v_other);
        check_true(FALSE,'Patient overlap should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20107,'Patient overlap across different doctors rejected');
    END;
    mc_api.book_appointment(v_patient,v_session2,2,v_adjacent_appointment);
    check_true(v_adjacent_appointment IS NOT NULL,'Adjacent patient appointments are allowed');
    BEGIN
        mc_api.book_appointment(v_patient2,v_session,99,v_other);
        check_true(FALSE,'Outside slot should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20106,'Slot outside session rejected');
    END;
    BEGIN
        mc_api.book_appointment(v_patient2,v_session,1.5,v_other);
        check_true(FALSE,'Fractional slot should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20106,'Fractional slot rejected');
    END;
    BEGIN
        mc_api.book_appointment(v_patient2,v_past_session,1,v_other);
        check_true(FALSE,'Past booking should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20105,'New booking in the past rejected');
    END;
    BEGIN
        mc_api.book_appointment(v_inactive_patient,v_session,3,v_other);
        check_true(FALSE,'Inactive patient should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20102,'Inactive patient cannot book');
    END;
    UPDATE doctors SET active_flag='N' WHERE doctor_id=v_doctor;
    BEGIN
        mc_api.book_appointment(v_patient2,v_session,3,v_other);
        check_true(FALSE,'Inactive doctor should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20102,'Inactive doctor cannot receive new bookings');
    END;
    UPDATE doctors SET active_flag='Y' WHERE doctor_id=v_doctor;
    UPDATE clinics SET active_flag='N' WHERE clinic_id=v_clinic;
    BEGIN
        mc_api.book_appointment(v_patient2,v_session,3,v_other);
        check_true(FALSE,'Inactive clinic should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20102,'Inactive clinic cannot receive new bookings');
    END;
    UPDATE clinics SET active_flag='Y' WHERE clinic_id=v_clinic;

    UPDATE doctor_sessions SET consultation_fee=1200 WHERE session_id=v_session;
    SELECT agreed_fee INTO v_number FROM appointments WHERE appointment_id=v_appointment;
    check_true(v_number=1000,'Booked fee survives later session price changes');
    BEGIN
        UPDATE appointments SET agreed_fee=1200 WHERE appointment_id=v_appointment;
        check_true(FALSE,'Booked fee mutation should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20113,'Booked fee protected by trigger');
    END;
    BEGIN
        UPDATE doctor_sessions SET start_time=start_time+INTERVAL '1' HOUR,
                                   end_time=end_time+INTERVAL '1' HOUR
        WHERE session_id=v_session;
        check_true(FALSE,'Session mutation should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20113,'Session with booking history cannot be moved');
    END;
    mc_api.record_payment(v_appointment,600,'CASH',NULL,v_payment);
    check_true(mc_api.appointment_balance(v_appointment)=400,'Partial payment updates balance');
    BEGIN
        mc_api.record_payment(v_appointment,401,'CASH',NULL,v_other);
        check_true(FALSE,'Overpayment should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20110,'Overpayment rejected');
    END;
    check_true(mc_api.appointment_balance(v_appointment)=400,'Failed payment leaves balance unchanged');
    mc_api.record_payment(v_appointment,400,'CARD','TEST-API-PAYMENT',v_payment2);
    check_true(mc_api.appointment_balance(v_appointment)=0,'Multiple payments can settle a fee');
    BEGIN
        mc_api.cancel_appointment(v_appointment,'Test cancellation');
        check_true(FALSE,'Paid cancellation should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20111,'Cancellation with unresolved payments rejected');
    END;
    mc_api.void_payment(v_payment2);
    mc_api.void_payment(v_payment);
    check_true(mc_api.appointment_balance(v_appointment)=1000,'Voided payments excluded from balance');
    mc_api.cancel_appointment(v_appointment,'Test cancellation after correcting demo payments');
    check_true(mc_api.appointment_balance(v_appointment)=0,'Cancelled booking has no amount due');
    mc_api.book_appointment(v_patient2,v_session,1,v_rebook);
    check_true(v_rebook IS NOT NULL,'Cancelled slot can be reused');
    BEGIN
        mc_api.record_consultation(v_rebook,'Demo','Demo',NULL,NULL,v_other);
        check_true(FALSE,'Future consultation should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20109,'Consultation before appointment time rejected');
    END;

    INSERT INTO appointments(session_id,patient_id,slot_no,agreed_fee,status,booked_at)
    VALUES(v_past_session,v_patient2,1,1000,'CONFIRMED',v_past-INTERVAL '1' DAY)
    RETURNING appointment_id INTO v_past_appointment;
    mc_api.record_consultation(v_past_appointment,'Synthetic symptoms',
        'Synthetic diagnosis','Software test record',v_today+7,v_consultation);
    SELECT status INTO v_status FROM appointments WHERE appointment_id=v_past_appointment;
    check_true(v_status='COMPLETED' AND v_consultation IS NOT NULL,
               'Consultation is recorded and appointment completed atomically');
    BEGIN
        mc_api.record_consultation(v_past_appointment,'Demo','Demo',NULL,NULL,v_other);
        check_true(FALSE,'Duplicate consultation should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20109,'Duplicate consultation rejected');
    END;
    BEGIN
        mc_api.save_prescription(v_consultation,'[]','Demo',v_other);
        check_true(FALSE,'Empty prescription should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20112,'Empty prescription rejected');
    END;
    v_json := '[{"medicine_id":' || v_inactive_medicine ||
        ',"dosage":"Demo","frequency":"Demo","duration_days":3}]';
    BEGIN
        mc_api.save_prescription(v_consultation,v_json,'Demo',v_other);
        check_true(FALSE,'Inactive medicine should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20102,'Inactive medicine rejected');
    END;
    SELECT COUNT(*) INTO v_count FROM prescriptions WHERE consultation_id=v_consultation;
    check_true(v_count=0,'Failed prescription leaves no empty header');
    v_json := '[{"medicine_id":' || v_medicine ||
        ',"dosage":"Demo","frequency":"Demo","duration_days":3}]';
    mc_api.save_prescription(v_consultation,v_json,'Synthetic prescription',v_prescription);
    SELECT COUNT(*) INTO v_count FROM prescription_items WHERE prescription_id=v_prescription;
    check_true(v_count=1,'Prescription JSON becomes relational line items');
    BEGIN
        mc_api.save_prescription(v_consultation,v_json,'Demo',v_other);
        check_true(FALSE,'Duplicate prescription should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20109,'Second prescription for same consultation rejected');
    END;
    INSERT INTO appointments(session_id,patient_id,slot_no,agreed_fee,status,booked_at)
    VALUES(v_past_session,v_patient3,2,1000,'CONFIRMED',v_past-INTERVAL '1' DAY)
    RETURNING appointment_id INTO v_no_show;
    mc_api.mark_no_show(v_no_show);
    SELECT status INTO v_status FROM appointments WHERE appointment_id=v_no_show;
    check_true(v_status='NO_SHOW','Ended unattended appointment can be marked no-show');
    mc_api.finish_session(v_past_session);
    SELECT status INTO v_status FROM doctor_sessions WHERE session_id=v_past_session;
    check_true(v_status='COMPLETED','Ended session can be completed after resolving bookings');
    mc_api.cancel_session(v_session,'Synthetic test session cancellation');
    SELECT status INTO v_status FROM appointments WHERE appointment_id=v_rebook;
    check_true(v_status='CANCELLED','Session cancellation also cancels active bookings');

    mc_reports.appointment_summary(v_today-90,v_today+90,v_rows);
    CLOSE v_rows;
    mc_reports.doctor_workload(v_today-90,v_today+90,v_rows);
    CLOSE v_rows;
    mc_reports.clinic_revenue(v_today-90,v_today+90,v_rows);
    CLOSE v_rows;
    mc_reports.outstanding_balances(v_rows);
    CLOSE v_rows;
    mc_reports.patient_history(v_patient2,v_rows);
    CLOSE v_rows;
    check_true(TRUE,'All five business-report cursors open successfully');
    BEGIN
        mc_reports.appointment_summary(v_today+1,v_today,v_rows);
        CLOSE v_rows;
        check_true(FALSE,'Invalid report date range should fail');
    EXCEPTION WHEN OTHERS THEN
        check_code(SQLCODE,-20116,'Invalid report date range rejected');
    END;
    ROLLBACK TO mc_test_suite;
    SELECT COUNT(*) INTO v_count FROM doctors WHERE registration_no IN ('TEST-API-1','TEST-API-2');
    check_true(v_count=0,'Test fixture rows were rolled back');
    DBMS_OUTPUT.PUT_LINE('Verification complete: ' || v_passes || ' business checks passed.');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK TO mc_test_suite;
        RAISE;
END;
/
WHENEVER SQLERROR CONTINUE NONE
WHENEVER OSERROR CONTINUE NONE
