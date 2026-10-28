# MediCare demonstration and test evidence

Use synthetic coursework records. The manual cases below are a checklist, not
a claim that every case has already passed against your live database. Record
the actual outcome, date and screenshot/file reference after running each case.
Do not rerun schema or seed scripts to prepare a demonstration.

## Confirmed checkpoints

| Check | Evidence/status |
| --- | --- |
| Schema and PL/SQL installation | Completed in the Mac Oracle container during setup |
| Backend Oracle connection | Verified on Mac using MEDICARE/FREEPDB1 |
| Read-only API smoke suite | All listed API endpoints and five reports passed on Mac |
| Backend automated suite | 27 tests passed with simulated connections |
| Frontend automated suite | 11 tests passed |
| Frontend production build | Passed |
| Desktop frontend workflows | Passed against isolated synthetic fixtures: registration, booking, conflict error, payment, consultation, prescription and patient history |
| Frontend against Mac Oracle API | User confirmed registration, booking, partial payment, consultation, prescription and five reports; screenshots retained in docs/evidence |
| Mobile browser, concurrency and final viva | To verify/prepare |

## Suggested demonstration order

1. Show the 12-table ER diagram and explain doctors/specializations, sessions,
   appointments, consultations/prescriptions and payments.
2. Open the overview and explain that its figures come from Oracle through the
   Express API. Show the **Connected** status.
3. Register a clearly labelled fictional patient. Find and edit that record.
4. Create a future doctor session with a valid facility, slot length and fee.
   Open its slots and book one for the fictional patient. Show the slot is taken.
5. Confirm the appointment and record a partial payment. Show its balance.
6. Record a consultation for an eligible pending appointment whose slot has
   started, then add a prescription with at least two synthetic medicine items.
   Use a separate eligible appointment if the future booking has not started.
7. Run all five reports. Use a date range covering the demonstration records.
   Show patient history for the consulted patient and export one report to CSV.
8. Explain one rejected booking/payment, the rollback path, and how data remains
   consistent. Show your own collected test evidence.

## Manual test matrix

| Case | Expected result | Live outcome/evidence |
| --- | --- | --- |
| Open frontend with API/Oracle running | Connected; current database figures shown | Confirmed, evidence 01 |
| Register/edit a fictional patient | Saved record appears with correct DOB/contact | Pending |
| Assign multiple doctor specializations | Saved links and readable list | Pending |
| Create an overlapping doctor session | Business error; no extra session saved | Pending |
| Book an available slot | One appointment; slot changes to booked | Pending |
| Book same patient twice in one session | Business error; no duplicate booking | Pending |
| Concurrently book one slot from two tabs | One booking succeeds; other rejects/refreshes | Pending |
| Cancel an unpaid appointment | Cancelled status; eligible future slot released | Pending |
| Cancel an appointment with recorded payment | Rejected until payment records are resolved under the package rules | Pending |
| Record partial payment | Correct remaining balance | Pending |
| Attempt payment above remaining balance | Business error; no new payment saved | Pending |
| Void an erroneous recorded payment | Voided status; balance recalculated | Pending |
| Consult a future slot | Rejected; no consultation saved | Pending |
| Consult a started pending appointment | Consultation saved; appointment completed | Pending |
| Save prescription with multiple medicines | Items shown under consultation and history | Pending |
| Run all five reports | Results match records and selected filters | Pending |
| Export/print a report | Correct headers, values and readable layout | Pending |
| Stop API and refresh frontend | Clear connection error and recovery after restart | Pending |
| Narrow browser window | Navigation, forms and tables remain usable | Pending |

Voiding a payment is a correction to coursework records, not a real refund.
Use recorded payments only; the application has no external payment gateway.

## Viva preparation

Explain these using your own source and actual test results:

- Primary/foreign keys, many-to-many doctor specializations and normalization.
- Conditional uniqueness for non-cancelled appointment slots.
- Why agreed fees are stored on appointments rather than recalculated from a
  session's current fee.
- MC_API procedures/functions, validation triggers, exceptions, row locking
  and rollback. Show a relevant procedure and trigger from the SQL source.
- MC_REPORTS REF CURSOR output and why the API consumes/closes the cursor before
  releasing its connection.
- Bind variables, one transaction per write request, database-side rules and
  the separation between frontend, API and Oracle.
- Date-only values versus timestamps, Sri Lanka timezone and LKR arithmetic.
- Limits of the local demo: no application login, no bank/card integration,
  synthetic data, and further live tests still to record.

## Repository/submission

Keep database SQL, backend/frontend source, package lockfiles, API reference,
ER diagram and your evidence together. Do not commit `.env`, credentials,
`node_modules` or `dist`. Initialize/push Git only after reviewing staged files.
Use the repository link requested by the coursework brief. Prepare the final
presentation and any required EER/report formatting against the marking rubric;
this source package does not claim those remaining submission items are done.

## Observed overpayment test

APT-221 had a LKR 6000 fee, LKR 4500 paid and LKR 1500 due. A direct POST of LKR 2000 returned ORA-20110. The user confirmed an unchanged balance and no extra payment. See docs/evidence/12_api_overpayment.json and validation_notes.md. Other Pending entries are a checklist to record separately, not claimed completed tests.
