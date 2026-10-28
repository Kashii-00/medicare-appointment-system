# MediCare Appointment Management System

Oracle Database 26ai Free + PL/SQL + Node.js/Express + React/Vite. This project
contains the database, backend API and clinic workspace frontend.

## Project structure

| Directory | Contents |
| --- | --- |
| backend/ | Express API, Oracle connection pool, validation and automated tests |
| frontend/ | React workspace, booking and clinical forms, five reports and CSV export |
| database/ | Schema, corrected PL/SQL packages, seed data, verification and report scripts |
| docs/ | ER diagrams, API reference, presentation, viva guide and test evidence |

For a fresh installation, follow [Oracle setup](docs/ORACLE_SETUP.md).
For the existing coursework installation, the container already contains the tables, packages and sample data.
The database scripts are included for source control and future reconstruction;
do not rerun schema creation or seeding on the database you have already set up.
If your backend already passes the smoke checks, keep its existing `.env` and
skip straight to the frontend section below.

## Run the backend on your Mac

Keep Docker Desktop running and the `medicare-oracle` container started.
Clone this repository and use the cloned directory: `git clone https://github.com/Kashii-00/medicare-appointment-system.git`.
Run these commands in a regular Mac Terminal, not at an Oracle `SQL>` prompt:

```bash
cd ~/medicare-appointment-system/backend
npm ci
cp .env.example .env
open -e .env
```

In the file that opens, replace `YOUR_MEDICARE_PASSWORD` with your MEDICARE
application-user password. Keep the double quotes. This is the account you
created for the coursework, rather than the SYS/SYSTEM administrator account.
Save the file and close the editor. Do not put the password into frontend code.

Then check the connection:

```bash
npm run check:db
```

Expected: `Oracle connection verified.` plus MEDICARE, FREEPDB1, valid object
counts and current row counts. Thin mode should be `true`. Oracle Client or
Instant Client installation is unnecessary for this project's driver mode.

Start the server:

```bash
npm start
```

Expected:

```text
Oracle connected: MEDICARE/FREEPDB1 (Thin mode: true).
MediCare API running at http://127.0.0.1:4000
Health check: http://127.0.0.1:4000/api/health
```

Keep that Terminal open. In a second Terminal tab:

```bash
cd ~/medicare-appointment-system/backend
npm run smoke
```

The smoke check calls the running backend, verifies real Oracle reads, checks
slot counts, and requests all five reports. It does not modify any records.
Success ends with `Read-only API smoke checks completed.`

For code changes, `npm run dev` restarts the backend when source files change.
Press Control+C in the server Terminal to stop it. To restart Oracle later:

```bash
docker start medicare-oracle
```

## Run the frontend on your Mac

Keep Oracle and the backend running. The `frontend` and `backend` directories are included in this repository. Open another
Terminal tab and run:

```bash
cd ~/medicare-appointment-system/frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. The header should show **Connected**, and the
overview should display your Oracle records. The default Vite proxy forwards
`/api` requests to the existing backend on `127.0.0.1:4000`. No frontend password
or environment file is needed with those defaults.

The workspace includes patients, doctors and their specializations, facilities,
medicines, sessions and slot availability, appointments, consultations,
prescriptions, payments and five reports. Forms show API business errors without
discarding the record being edited. Report results can be exported as CSV or
printed. Patient history groups consultation and prescription information.

The five reports are appointment summary, doctor workload, clinic revenue,
outstanding balances and patient history. Date filters and appointment times use
Sri Lanka time; amounts use LKR.

For a different backend port, copy `frontend/.env.example` to `frontend/.env`,
change `BACKEND_URL`, and restart Vite. Keep `VITE_API_URL=/api`. For a direct API
URL or another browser origin, also update backend `CORS_ORIGINS` and restart
the backend.

To check a production build locally:

```bash
npm run build
npm run preview
```

Preview uses port 4173. Add `http://localhost:4173` and/or
`http://127.0.0.1:4173` to backend `CORS_ORIGINS` before using it, then restart
the backend. This is a local coursework application, not a hosted deployment.

## Tests and verification status

`npm test` runs 27 automated checks for validation, error mapping, transaction
commit/rollback, connection and cursor cleanup, bound payment data and HTTP
routes/CORS. These tests use simulated database connections and do not alter
Oracle. They passed in the authoring environment using the pinned dependency
versions. They do not replace `npm run check:db` or `npm run smoke` on your Mac.

The database schema, corrected PL/SQL packages, sample data and PL/SQL checks
were run in your Oracle container during setup. The backend connection check and
all read-only API smoke checks subsequently passed on your Mac against Oracle,
including slot availability and all five reports.

In `frontend/`, `npm test` runs 11 checks covering date/time handling,
consultation eligibility, CSV escaping, API failures, pagination and UI ID
generation. These passed, and `npm run build` succeeded. Desktop browser checks
with isolated synthetic fixtures verified registration, booking, duplicate
booking errors, payment recording, consultation, prescription and patient
history. Test fixtures are excluded from the delivered source. The frontend was subsequently checked against the Mac Oracle API. Registration, booking, partial payment, consultation, prescription and all five reports worked. A direct overpayment request returned ORA-20110 and left the balance unchanged. See [test evidence](docs/evidence/validation_notes.md).

See [the demo and testing checklist](docs/DEMO_CHECKLIST.md) for manual cases and
evidence to collect from your own running application.

## Application behaviour

- Business operations call MC_API instead of implementing competing booking,
  cancellation, consultation or payment rules in JavaScript.
- Each write request owns one connection/transaction. It commits only after the
  entire operation succeeds; failures roll back before the connection is released.
- Doctor/specialization edits are atomic. Invalid related IDs roll back the
  doctor change as well as its specialization links.
- Reports call MC_REPORTS and fetch/close its REF CURSOR while the connection
  is still open. Report results explicitly indicate truncation at their limit.
- Names/phones/identifiers are validated, user values use bind variables, and
  only fixed allowlisted master-table columns can be written.
- Master records with history can be deactivated with `active_flag: "N"`.
- Recorded payments are bookkeeping; CARD/BANK_TRANSFER does not contact a
  payment provider. Voiding corrects a record and is not a bank refund.
- The server binds to the Mac loopback interface. This coursework application
  has no application login and is intended for the local demonstration workflow.
- `.env` and `node_modules` are excluded from Git. The repository contains the
  example configuration only, with no actual credentials.

## Dates and currency

All currency values are LKR. The backend validates up to two decimal places;
balances/overpayment rules are calculated in Oracle NUMBER arithmetic.

Session creation accepts Sri Lanka local timestamps such as
`2026-11-01T16:00:00`, without a timezone suffix. Input dates use `YYYY-MM-DD`.
The backend sets its application and connection timezone to `Asia/Colombo`.
Responses use UTC ISO strings for timestamps, and date-only strings for birth
dates, follow-up dates and report calendar dates. The frontend displays
timestamps with the `Asia/Colombo` timezone and preserves birth-date calendar
days separately from timestamps.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing .env | Run `cp .env.example .env` from backend/ and edit it |
| ORA-01017 | Use the MEDICARE password in .env and retain the quotes |
| Database unavailable / listener error | Start Docker and medicare-oracle; wait for database readiness |
| Missing/invalid database objects | Check stage-2 installation; do not recreate the tables |
| Port already in use | Change PORT in .env; set API_BASE_URL when running the smoke script |
| Browser origin rejected | Add the exact frontend origin to CORS_ORIGINS and restart |
| Frontend shows disconnected / cannot reach MediCare | Keep the backend Terminal open; check health on port 4000 and BACKEND_URL |
| Vite port 5173 is already in use | Stop the earlier frontend process, then run npm run dev again |
| Slot already taken / patient overlap | Choose another slot; Oracle rejected the conflicting booking |
| Consultation is rejected for a future slot | Record it after the slot starts, using a pending appointment |

For another port, run a smoke check with, for example:

```bash
API_BASE_URL=http://127.0.0.1:4001 npm run smoke
```

## Official documentation

- [node-oracledb: connection pooling and Thin mode](https://node-oracledb.readthedocs.io/en/latest/user_guide/connection_handling.html)
- [node-oracledb: binding values and REF CURSOR parameters](https://node-oracledb.readthedocs.io/en/latest/user_guide/bind.html)
- [node-oracledb: dates, timestamps and result sets](https://node-oracledb.readthedocs.io/en/latest/user_guide/sql_execution.html)
- [Express error handling](https://expressjs.com/en/5x/guide/error-handling/)

## Presentation and assessment

[Presentation](docs/presentation/MediCare_Presentation_Ready.pptx), [viva guide](docs/presentation/Viva_Guide.md) and [full ER diagram](docs/diagrams/MediCare_ER_Diagram.pdf) are included. Fill in the student details on the first slide. The assessment requests a complete system, presentation/viva and the GitHub link through the LMS. A separate written report is not explicitly required.
