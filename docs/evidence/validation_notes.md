# API overpayment test

Date: 27 October 2026.

Request: POST /api/payments with appointment_id 221, amount 2000, payment_method CASH.

Precondition: the captured appointment fee is LKR 6000, completed payment LKR 4500, remaining balance LKR 1500.

Observed response: see 12_api_overpayment.json, copied from the Terminal output supplied in the walkthrough. The user subsequently confirmed that the balance stayed LKR 1500 with no extra payment. This confirmation is a user-reported check, not a separate after-test screenshot.
