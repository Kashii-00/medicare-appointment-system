# MediCare viva preparation

Use this as a practice guide. Explain the source in your own words and keep the working application ready. The slides include speaker notes. Fill in your student details on slide 1. A suggested pace is 8 to 10 minutes for the slides, followed by the live demonstration, unless the lecturer gives a different limit.

## Opening

MediCare is a local appointment management system using Oracle. It supports doctor and patient records, facilities, session slots, consultations, prescriptions and payment records. React provides the interface, Express exposes the API, and Oracle PL/SQL implements the business operations and five reports.

## Questions and answers

### Why are there 12 tables?
Each table stores a separate subject or association. Sessions describe doctor availability, appointments describe patient bookings, consultations store visits, and prescriptions separate their header from medicine lines. The split avoids repeating lists and unrelated facts in one record.

### Why use DOCTOR_SPECIALIZATIONS?
A doctor may have several specializations, and a specialization may apply to several doctors. The junction table resolves that many to many relationship. Its composite primary key prevents the same pair from appearing twice.

### Which relationships are one to one?
An appointment may have zero or one consultation, enforced by a unique appointment_id foreign key. A consultation may have zero or one prescription, enforced by unique consultation_id. Each existing child must reference a parent.

### Is a prescription allowed to have no items?
The foreign keys alone permit zero items. MC_API.save_prescription requires a non-empty item array and creates the header and lines atomically. If an item is invalid, it rolls the operation back.

### What is third normal form in this design?
Under the stated dependencies, non-key facts depend on the key rather than another non-key fact. Medicine product details belong in MEDICINES, while prescription instructions belong to a numbered prescription line. Appointments reference sessions to obtain doctor and clinic details.

### Why store agreed_fee?
It is the historical fee accepted for the appointment. Changing the session fee must not rewrite the amount already agreed for previous bookings.

### How do you prevent double booking?
The package checks slot availability and patient overlap. Conditional unique indexes also prevent two non-cancelled appointments for the same session slot or the same patient in one session. Cancelled rows remain as history but release their participation in those indexes.

### Which functions and procedures can you show?
Show MC_API.patient_age and appointment_balance. Show book_appointment or record_payment as procedure examples. Procedures perform business operations and may return IDs through OUT parameters. Functions return a calculated value.

### Where is the explicit cursor?
cancel_session declares c_bookings FOR UPDATE. Its cursor FOR loop checks session bookings, then updates eligible rows using WHERE CURRENT OF. A later error rolls back the whole operation to its savepoint.

### What does a REF CURSOR do?
It returns a query result for the caller to fetch. MC_REPORTS has five procedures with OUT SYS_REFCURSOR. The API fetches the rows and closes the cursor before releasing the connection.

### Which trigger can you explain?
trg_patients_validate normalizes values and rejects a future birth date. trg_sessions_history prevents moving a session that has booking history. trg_payments_history prevents deleting or rewriting payment details and prevents restoring a voided record.

### What happens when a payment exceeds the balance?
record_payment locks the appointment, calculates the remaining balance and rejects an excessive amount with ORA-20110. The tested request attempted LKR 2000 against LKR 1500 remaining. Oracle returned Payment exceeds the outstanding balance. The balance stayed unchanged and no extra payment appeared.

### What is the difference between browser and database validation?
Browser validation gives immediate feedback but a caller can bypass it. A direct API call bypassed the browser input maximum and still reached the Oracle rejection. The two checks supply separate evidence.

### Why lock the appointment row?
All package payment changes use the same parent lock. This serializes the balance check and write for that appointment, rather than allowing two requests to calculate against the same old balance. A true concurrent-client test is still additional evidence to collect.

### Who commits the transaction?
The PL/SQL business procedures do not commit. Each uses a savepoint and rolls back on failure. The Express service commits a successful write request or rolls back a failed one, then releases its connection.

### What are the five reports?
Appointment summary, doctor workload, clinic revenue, outstanding balances and patient history. Clinic revenue uses completed payments and payment dates. Patient history can return several result rows for one visit because of medicine lines.

### Why can a completed appointment still appear as outstanding?
Consultation completion and payment settlement are separate states. A completed visit may still have a positive balance. The outstanding report includes non-cancelled appointments with a balance above zero.

### Does recording a card payment charge a real card?
No. CASH, CARD and BANK_TRANSFER are bookkeeping methods in this coursework application. There is no external gateway. Voiding a payment corrects the record and does not perform a bank refund.

### Can direct SQL bypass the business package?
Yes, the local API uses the MEDICARE schema owner. Constraints and triggers still apply to direct DML, but cross-row rules implemented only in MC_API require package use. A production design should use a restricted application account with suitable package grants.

### What did you actually test?
The local walkthrough covered registration, session creation, booking, partial payment, browser validation, Oracle overpayment rejection, consultation, prescription and all five reports. The backend smoke calls passed against Oracle. The automated backend tests use simulated connections. Avoid claiming production load, every negative path or concurrent races as tested.

## Live demo sequence

1. Keep Docker Desktop and medicare-oracle running. Keep backend and frontend Terminal tabs open.
2. Open the overview and point out Connected.
3. Show the fictional doctor/patient and a future session. Book an available slot.
4. Show the captured payment example: fee LKR 6000, paid LKR 4500, due LKR 1500. If these records have changed, use their current values.
5. Show browser rejection of an excessive amount. Explain the separate saved API response ORA-20110.
6. Use a separate started pending appointment for consultation, then save a prescription with readable fictional instructions.
7. Show all five reports, with date ranges that cover the relevant records.
8. Open 02_business_logic.sql to show a function, an explicit cursor, a trigger and the exception/rollback path.

Keep a separate eligible consultation booking ready. A future booking cannot be consulted before its start time. CON-221 and APT-221 are different table identifiers and do not imply the same underlying visit.

## GitHub submission checklist

Place the source, SQL and ER diagram in the repository. Include package-lock files and setup instructions. Presentation and test evidence can go in a docs folder. Exclude .env, passwords, node_modules and dist. Review the files before committing. The assessment requests the GitHub repository link through the LMS and a presentation/viva, without explicitly requiring a separate written report.

Run these read-only checks from your project folder before committing:

```bash
git status --short
git check-ignore backend/.env frontend/node_modules
```

Do not run these until you are in an initialized Git repository. Create/link the repository and review staged files before pushing. No repository has been created or published by this preparation step.
