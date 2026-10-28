## Slide 1

Introduce the coursework and your own name. Explain that this is a local Oracle database application. Source: assessment brief pages 1 to 3. Suggested presentation duration is 8 to 10 minutes plus demonstration.

## Slide 2

The platform links doctors, patients and facilities. Registration, scheduling, consultation, prescriptions and payment records all use the same Oracle data. Source: evidence E01 and coursework brief page 2. The overview totals are captured sample values rather than fixed performance claims.

## Slide 3

React calls /api through the Vite development proxy. Express validates and binds inputs. The service uses node-oracledb Thin mode and a pool to access MEDICARE in FREEPDB1 on port 1521. MC_API performs business operations and MC_REPORTS produces reports. Sources: backend/src/config.js, oracle.js, service.js and frontend/vite.config.js.

## Slide 4

This editable diagram summarizes seven of the twelve tables. Each appointment references one session and one patient. A session references one doctor and one facility. DOCTOR_SPECIALIZATIONS resolves the many to many relationship. Physical SQL cardinalities permit zero links, while doctor creation and full editing through the API require at least one specialization. Source: 01_medicare_schema.sql and backend validation.js.

## Slide 5

This diagram adds five tables to APPOINTMENTS, giving twelve in total. Unique foreign keys permit one consultation per appointment and one prescription per consultation. DDL alone permits a prescription with no lines. MC_API.save_prescription requires at least one item and saves all rows atomically. Source: schema and save_prescription in 02_business_logic.sql.

## Slide 6

Explain the stated functional dependencies. Separate medicine details from prescription instructions. Explain that agreed_fee records the historical amount accepted at booking, so it is a fact about the appointment. Conditional unique indexes enforce only non-cancelled slot and patient participation. Source: 01_medicare_schema.sql.

## Slide 7

MC_API has eleven public procedures and two public functions. patient_age and appointment_balance calculate values. cancel_session declares c_bookings FOR UPDATE and uses WHERE CURRENT OF. Five triggers normalize values and protect history. MC_REPORTS has five SYS_REFCURSOR procedures. Source: 02_business_logic.sql.

## Slide 8

record_payment locks the appointment row before reading its balance. This serializes payment changes using the same parent lock. It rejects a payment above the balance before INSERT. A procedure failure rolls back to its savepoint. The API commits success and rolls back failure. Business rules require MC_API, since the owner account can bypass packages with arbitrary DML. Sources: MC_API.record_payment and backend/src/service.js.

## Slide 9

Evidence E03 shows appointment APT-221 for Test Patient and Test Doctor. The fee is LKR 6000 and the completed CASH payment is LKR 4500, leaving LKR 1500. Explain that voiding retains the original record but removes its amount from completed totals. The app does not charge a real card or send a bank transfer.

## Slide 10

MC_REPORTS opens a SYS_REFCURSOR for each report. The API fetches and closes it before releasing the connection. Revenue uses payment dates and completed payments. Date ranges include both selected calendar dates. Patient history may return several rows for one visit because each medicine line contributes a row. Source: MC_REPORTS and evidence E07 to E11.

## Slide 11

E04 shows browser max validation. A separate direct POST /api/payments with appointment_id 221, amount 2000 and CASH returned Oracle error ORA-20110. The user confirmed no extra payment and an unchanged LKR 1500 balance. Live smoke checks passed. Backend 27 tests use simulated connections. Frontend 11 unit tests and build passed in the authoring environment. True concurrent-client testing remains additional work.

## Slide 12

Keep Docker, the backend and frontend running. Use fictional data. A consultation requires a pending booking whose start time has passed, so prepare a separate eligible appointment. A future booking can demonstrate booking and payments. Use readable fictional clinical notes rather than the temporary test entries in the earlier screenshots.

## Slide 13

The main local workflows and reports have passed the walkthrough checks. Do not claim all possible negative paths or concurrent races were tested. The current app has no login or external payment gateway. Future work includes a restricted application database account, authentication, backup/restore validation and true concurrent booking tests. Conclude by opening the working system and the SQL source for questions.
