# MediCare API reference

Base URL: `http://127.0.0.1:4000/api`. JSON request bodies use
`Content-Type: application/json`. Dates are YYYY-MM-DD; session inputs are local
Sri Lanka timestamps YYYY-MM-DDTHH:mm[:ss]. Money is numeric LKR, at most two
decimal places. Timestamps in responses are UTC ISO strings.

Single-record responses: `{ "data": { ... } }`.
List responses: `{ "data": [ ... ], "pagination": { "limit": 100,
"offset": 0, "count": 30, "has_more": false } }`.
Errors: `{ "error": { "code": "...", "message": "...", "request_id": "..." } }`.

## Health and dashboard

| Method | Path | Result |
| --- | --- | --- |
| GET | /health | Actual Oracle connection health |
| GET | /dashboard | Counts, collected revenue and outstanding balances |

## Master records

Each resource below supports GET list, GET /:id, POST, PUT /:id, PATCH /:id.
PUT requires the create-required fields. PATCH accepts a non-empty subset.
Unknown fields are rejected. Lists accept limit (1-200), offset, q and
active_flag (Y/N, except specializations). Doctors additionally accept
specialization_id. Mark a doctor/patient/clinic/medicine inactive with PATCH
`{ "active_flag": "N" }`.

| Resource | Required create fields | Optional fields |
| --- | --- | --- |
| /patients | first_name, last_name, date_of_birth, phone | gender, email, address, active_flag |
| /doctors | registration_no, first_name, last_name, phone, specialization_ids | email, active_flag |
| /clinics | clinic_name, address, city, phone | facility_type, active_flag |
| /specializations | specialization_name | description |
| /medicines | medicine_name, strength, dosage_form | active_flag |

gender: MALE/FEMALE/OTHER/UNSPECIFIED. facility_type: HOSPITAL/CLINIC.
specialization_ids is a non-empty array of unique numeric IDs. Phone is a
string, preserving leading zeros and an international + prefix.

DELETE /specializations/:id removes an unused specialization. Foreign keys
reject deletion when doctors still reference it. Other master records use
deactivation to retain history.

## Sessions and availability

| Method | Path | Body/query |
| --- | --- | --- |
| GET | /sessions | doctor_id, clinic_id, status, from, to, upcoming=true/false, limit, offset |
| GET | /sessions/:id/slots | Returns session plus numbered slots and Y/N availability |
| POST | /sessions | doctor_id, clinic_id, start_time, end_time, slot_minutes, consultation_fee |
| PATCH | /sessions/:id/fee | consultation_fee |
| PATCH | /sessions/:id/cancel | reason |
| PATCH | /sessions/:id/complete | Empty JSON object |

Example (replace IDs with actual IDs from the master list responses):

```json
{
  "doctor_id": 1,
  "clinic_id": 1,
  "start_time": "2026-11-01T16:00:00",
  "end_time": "2026-11-01T18:00:00",
  "slot_minutes": 15,
  "consultation_fee": 2500
}
```

Session status: SCHEDULED/COMPLETED/CANCELLED. Fee changes affect new bookings.
Sessions with booking history cannot be moved or resized. Cross-clinic doctor
overlap is rejected by MC_API. Cancellation is atomic across the session's
bookings and fails if paid/completed records still need resolution.

## Appointments

| Method | Path | Body/query |
| --- | --- | --- |
| GET | /appointments | patient_id, doctor_id, session_id, status, from, to, limit, offset |
| GET | /appointments/:id | Booking, balance, consultation/prescription and payments |
| POST | /appointments | patient_id, session_id, slot_no |
| PATCH | /appointments/:id/confirm | Empty JSON object |
| PATCH | /appointments/:id/cancel | reason |
| PATCH | /appointments/:id/no-show | Empty JSON object |

Status: BOOKED/CONFIRMED/CANCELLED/COMPLETED/NO_SHOW. The booking fee comes from
the database session; clients cannot supply or override it. Slots are 1-based.
The unique index and MC_API enforce occupancy, patient/session uniqueness and
cross-doctor patient timing rules. Cancelled slots can be reused.

## Consultations and prescriptions

| Method | Path | Body/query |
| --- | --- | --- |
| GET | /consultations | patient_id, limit, offset |
| GET | /consultations/:id | Consultation with prescription and medicine lines |
| POST | /consultations | appointment_id, diagnosis; optional symptoms, clinical_notes, follow_up_date |
| POST | /prescriptions | consultation_id, items; optional notes |

Prescription item shape:

```json
{
  "medicine_id": 1,
  "dosage": "Fictional demonstration dosage",
  "frequency": "Fictional demonstration frequency",
  "duration_days": 3,
  "instructions": "Synthetic software-test data only"
}
```

items must contain 1-999 objects, with medicine_id, dosage, frequency and
duration_days (1-365). instructions is optional. Prescriptions are saved in one
transaction; failed items do not leave an empty header. There is one
prescription per consultation. Completed consultations remain in patient history.

## Payments

| Method | Path | Body/query |
| --- | --- | --- |
| GET | /payments | appointment_id, status, limit, offset |
| POST | /payments | appointment_id, amount, payment_method; optional reference_no |
| PATCH | /payments/:id/void | Empty JSON object |

payment_method: CASH/CARD/BANK_TRANSFER. Payment status: COMPLETED/VOIDED.
MC_API serializes payments on their appointment, rejects overpayment and
excludes voided corrections from balances. No external card charge or refund is
performed by this coursework API.

## Reports

GET /reports lists the five report definitions. All report endpoints accept
limit (default 5000, maximum 10000). The response meta includes report,
row_count, limit and truncated. All REF CURSORS are fetched and closed before
the connection is returned to the pool.

| GET path | Required query parameters |
| --- | --- |
| /reports/appointment-summary | from, to |
| /reports/doctor-workload | from, to |
| /reports/clinic-revenue | from, to |
| /reports/outstanding-balances | None |
| /reports/patient-history | patient_id |

Date ranges include both specified clinic calendar dates. Revenue is based on
completed payment dates, not appointment dates. Patient history contains one row
per medicine line, with repeated consultation details for grouping in the UI.

## Error responses

400: invalid request; 404: unknown record/report; 409: booking/state/uniqueness
conflict; 422: database business rule or constraint rejection; 503: unavailable
database or timeout. Internal SQL and PL/SQL stacks are not returned to the
browser. The request ID can be used to correlate a server error.
