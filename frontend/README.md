# MediCare frontend

React clinic workspace for the MediCare Oracle coursework API. Requires Node.js
22.14.0 or newer. Your existing backend and Oracle container must stay running.

## Start on your Mac

Extract `MediCare_Frontend.zip`. Move the `frontend` folder beside your existing
`backend` folder, giving `~/Downloads/medicare-coursework/frontend`.
Run these commands in Mac Terminal, not SQL*Plus:

```bash
cd ~/Downloads/medicare-coursework/frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Expect **Connected** at the top and records on
the overview. This uses your existing Oracle data through the API on port 4000.
Do not rerun database creation or seed scripts.

No frontend `.env` or database password is required. If you changed the backend
port, copy `.env.example` to `.env`, edit `BACKEND_URL`, and restart Vite. Leave
`VITE_API_URL=/api` to use the development proxy. Backend CORS defaults allow
both localhost and 127.0.0.1 on port 5173.

## Workspace

- Overview, patient records and patient history.
- Doctors, specializations, facilities and medicines.
- Doctor sessions, slot availability and appointment booking/status changes.
- Consultations and prescriptions with multiple medicine items.
- Recorded payments, balances and voiding erroneous payment records.
- Five business reports, date/patient filters, CSV export and print layouts.

All times display in Asia/Colombo and all amounts use LKR. Consultations require
a pending appointment whose slot has started. Bookings, cancellations and
payments remain subject to the Oracle package rules. CARD/BANK_TRANSFER records
do not charge a card or initiate a bank transfer.

## Verification

```bash
npm test
npm run build
```

The 11 automated frontend tests and production build passed. Desktop browser
checks used isolated synthetic fixtures for registration, booking, conflicting
booking, payment recording, consultation, prescription and patient history.
The delivered project contains no fixture API or fallback sample records.
The frontend was subsequently verified against the Mac API during the coursework walkthrough, including booking, payment, consultation, prescription and reports. The backend read-only API smoke checks have already passed on
your Mac.

`npm run preview` serves a built frontend on port 4173 with the API proxy. For
that port, add the exact preview origin to backend `CORS_ORIGINS`, then restart
the backend. Standard development on port 5173 needs no CORS change.

## Source and configuration

`src/App.jsx` contains navigation and connection status; `src/pages/` contains
the screens/forms; `src/lib.js` handles API requests, dates and CSV export;
`src/context.jsx` handles data refresh, dialogs and notifications.

The ZIP excludes installed dependencies, build output and real environment
files. `npm ci` installs the pinned dependencies using `package-lock.json`.
This is a local staff workspace without application authentication.
