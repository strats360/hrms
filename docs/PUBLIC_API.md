# Saralix public API and webhooks

## API keys

Create a key under Settings, API & webhooks. Pick what it can read. The key is shown once.

Send it with every request:

```
Authorization: Bearer sx_<key id>.<secret>
```

Base address: `https://<your site>/api/v1`. Every endpoint is read only and answers JSON.

| Endpoint | Scope | What you get |
| --- | --- | --- |
| `GET /employees?page=&pageSize=&status=&updatedSince=` | employees:read | Employee ID, name, work email, phone, status, type, joining and last day, department, designation, branch, manager, entity and custom fields. No salary, bank or ID numbers. Up to 200 a page; `hasMore` says if there are more. |
| `GET /employees/:id` | employees:read | One employee, by ID or employee code. |
| `GET /payroll/runs?page=&pageSize=` | payroll:read | Approved and paid runs with their totals. |
| `GET /payroll/runs/:id/payslips` | payroll:read | Each payslip's earnings, deductions, employer contributions and net pay. |
| `GET /attendance?from=&to=` | attendance:read | Daily attendance, up to 62 days at a time. |
| `GET /leave?from=&to=` | leave:read | Leave requests overlapping the dates, up to 62 days at a time. |

Errors use the same shape as the rest of the API: `{ "error": { "message": "...", "code": "..." } }`, with 401 for a missing or revoked key, 403 for a scope the key doesn't have, and 422 for bad query values.

## Webhooks

Add a webhook under Settings, API & webhooks with a public https address and the events you want:

`employee.created`, `employee.updated`, `employee.exited`, `payroll.approved`, `payroll.paid`, `leave.approved`.

Each delivery is a POST with this body:

```json
{ "id": "<delivery id>", "event": "employee.updated", "createdAt": "2026-11-20T10:15:00.000Z", "data": { } }
```

and these headers: `X-Saralix-Event`, `X-Saralix-Delivery` and `X-Saralix-Signature: t=<unix seconds>,v1=<hex>`.

To check the signature, compute HMAC SHA-256 of `<t>.<raw body>` with the signing secret you were shown when you added the webhook, and compare it with `v1`. Reject deliveries where `t` is more than five minutes old.

Answer with any 2xx within 10 seconds. Otherwise we retry after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then mark the delivery failed. You can see recent deliveries and retry one from the settings page. Deliveries can arrive more than once, so use the delivery ID to ignore repeats.

What events carry:

- Employee events: ID, employee code, name, status, and for updates the names of the fields that changed (bank and ID number changes are never named).
- Payroll events: the run's ID, entity, period, pay date and totals. Never anyone's pay.
- Leave approved: the request code, employee, dates and days.
