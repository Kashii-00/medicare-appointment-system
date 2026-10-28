-- Demonstrate the five PL/SQL reports with SQL*Plus REF CURSOR variables.
-- Run after 02 and 03. Read-only: this script does not change records.
SET DEFINE OFF
SET SERVEROUTPUT ON
SET LINESIZE 240
SET PAGESIZE 100
SET LONG 2000
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
ALTER SESSION SET TIME_ZONE = 'Asia/Colombo';
ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD';
ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI';
COLUMN clinic_name FORMAT A35
COLUMN doctor_name FORMAT A25
COLUMN patient_name FORMAT A25
COLUMN status FORMAT A12
COLUMN diagnosis FORMAT A38
COLUMN symptoms FORMAT A28
COLUMN medicine_name FORMAT A22
COLUMN instructions FORMAT A45
COLUMN prescription_notes FORMAT A45

VARIABLE report_rows REFCURSOR
-- SQL*Plus does not support DATE as a VARIABLE datatype. Store ISO strings
-- in these host variables and convert explicitly when calling the reports.
VARIABLE from_date VARCHAR2(10)
VARIABLE to_date VARCHAR2(10)
VARIABLE history_patient NUMBER

BEGIN
    IF SYS_CONTEXT('USERENV','SESSION_USER') <> 'MEDICARE'
       OR SYS_CONTEXT('USERENV','CON_NAME') <> 'FREEPDB1' THEN
        RAISE_APPLICATION_ERROR(-20100, 'Connect as MEDICARE to FREEPDB1.');
    END IF;
    :from_date := TO_CHAR(TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS DATE))-30,'YYYY-MM-DD');
    :to_date := TO_CHAR(TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Colombo' AS DATE))+30,'YYYY-MM-DD');
    SELECT MIN(a.patient_id) INTO :history_patient
    FROM appointments a JOIN consultations c ON c.appointment_id=a.appointment_id;
END;
/

PROMPT REPORT 1 - Appointment counts by date, clinic and status
EXEC mc_reports.appointment_summary(TO_DATE(:from_date,'YYYY-MM-DD'),TO_DATE(:to_date,'YYYY-MM-DD'),:report_rows);
PRINT report_rows

PROMPT REPORT 2 - Doctor workload by date range
EXEC mc_reports.doctor_workload(TO_DATE(:from_date,'YYYY-MM-DD'),TO_DATE(:to_date,'YYYY-MM-DD'),:report_rows);
PRINT report_rows

PROMPT REPORT 3 - Collected revenue by clinic and payment date
EXEC mc_reports.clinic_revenue(TO_DATE(:from_date,'YYYY-MM-DD'),TO_DATE(:to_date,'YYYY-MM-DD'),:report_rows);
PRINT report_rows

PROMPT REPORT 4 - Outstanding appointment balances
EXEC mc_reports.outstanding_balances(:report_rows);
PRINT report_rows

PROMPT REPORT 5 - Patient consultation and prescription history
PRINT history_patient
EXEC mc_reports.patient_history(:history_patient,:report_rows);
PRINT report_rows

PROMPT All five report demonstrations finished.
WHENEVER SQLERROR CONTINUE NONE
WHENEVER OSERROR CONTINUE NONE
