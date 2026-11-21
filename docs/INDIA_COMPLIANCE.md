# Indian compliance: the Labour Codes and the Income Tax Act 2025

This tracks the India HR compliance report (20 Nov 2026) against Saralix. Every rate, ceiling and slab is a dated rule in the statutory master, with its source, so a labour law consultant can correct a figure without a code change. The report is built from published summaries, not the gazette text, so treat new figures as provisional until a consultant confirms them.

## Phase A: payroll correctness ✅

| Change | What Saralix does now |
| --- | --- |
| EPF wage ceiling ₹25,000 from 17 Sep 2026 | A new live PF version from 17 Sep 2026 (₹15,000 before). EPS tops out at ₹2,083 and EDLI at ₹125. When the ceiling changes partway through a month, it's split by days: September 2026 is 16 days at ₹15,000 and 14 at ₹25,000. Existing sites get the new version on their next deploy. |
| The 50% wage rule | "Code wages" are basic plus allowances marked as wages (dearness or retaining allowance), and never less than half the gross. PF, ESI eligibility, gratuity and leave encashment all use them. Salary structures solve the CTC with employer PF on Code wages. Payroll items keep the Code wages they used, and the ECR file reads them. |
| ESI | Eligibility is on Code wages, so a gross of up to about ₹42,000 can be covered. Someone covered earlier in a contribution period (April to September, October to March) stays covered to its end. The limit is ₹25,000 for persons with disability (a tick box on the employee). Contributions stay on gross wages paid. |
| Gratuity | Five years of continuous service (warning from 4 years 240 days, since some courts count that as five). Fixed term employees, a new employment type, get it pro rata after one year. It's on Code wages, capped at ₹20 lakh. The settlement shows the 30 day payment deadline and the 2 working day deadline for wages. |
| Income Tax Act 2025 | From tax year 2026-27, screens, PDFs and files say Form 130 (was Form 16), Form 138 (was 24Q), Form 124 (was 12BB) and "tax year". FY 2025-26 and earlier keep the old names. Section numbers were taken out of warnings and labels. |
| HRA 50% cities | From 2026-27 the employee's tax declaration lists Bengaluru, Hyderabad, Pune and Ahmedabad with the four metros. |

To confirm with a consultant: whether ESI contributions move to Code wages too (Saralix keeps them on gross), whether the gratuity "five years" follows the 240 day rule in your state, and the September 2026 split.

## Phase B: state coverage

- **Professional tax** ✅ for every state in the report except Meghalaya and Puducherry, where published slabs disagree (payroll flags them as not configured). Kerala and Tamil Nadu are half-yearly on the half year's income, deducted in the month it's due. Bihar, Jharkhand and Manipur are yearly on the year's income. Odisha, Arunachal Pradesh and Chhattisgarh have none. Persons with disability are exempt, and a state can set a senior citizen age. Due dates added for Andhra Pradesh, Telangana, Madhya Pradesh, Assam, Nagaland, Gujarat, Punjab and Tripura. To confirm: Assam, Mizoram, Nagaland and Tripura, where the report's summary is simpler than the state tables.
- **Labour welfare fund** ✅ for all 16 states in the report: half-yearly in June and December, monthly (Haryana as 0.2% up to ₹35 with the employer paying double, Punjab, Chandigarh, Kerala), and yearly in December (Andhra Pradesh, Karnataka, Tamil Nadu, Telangana). Rules can exclude staff above a wage limit. Kerala uses the shops rate (IT and ITES pay ₹100 + ₹100).
- **Minimum wages** by state, zone, industry and skill, revised every 1 April and 1 October, never below the central floor wage: next.

## Phase C: new features ✅

| Change | What Saralix does now |
| --- | --- |
| Statutory bonus | Already paid through payment batches; now on Code wages, counted at ₹7,000 a month or the branch state's minimum wage if higher, with the 30 November due date. |
| OSH Code leave | A leave type can accrue "1 day per 20 days worked last year", credited once 180 days were worked, from attendance (present, late and work from home count, half days as half). Set its carry forward to 30. |
| Overtime | Still twice the rate. The overtime screen flags anyone over 144 hours this quarter (the central cap, changeable in settings) and anyone without written consent, a new tick box on the employee. |
| Retrenchment | A new exit type: 15 days' wages for each completed year (a year's service needed; tax free up to ₹5 lakh), notice pay in lieu, and the re-skilling fund (15 days' wages within 10 days) shown as an employer due. Outside India it settles as a termination. |
| Appointment letter | The built in template now carries the OSH Code's fields: date of birth, Aadhaar (last 4, with consent), type of employment, skill category, wages and social security cover. Saved letters go to the employee's documents and the audit log. |
| Registrations | Indian entities list EPF, ESI, Shops and Establishments, Labour Code, PT, LWF and contract labour registrations, each with a renewal date. Renewals due in 90 days (and overdue ones) show on the compliance calendar. |
| Headcount thresholds | The compliance overview shows, for each entity and state, employees and workers (managers earning over ₹18,000 left out) and the obligations they switch on, including the ones within 20% of a threshold. |
| Calendar | Adds the POSH annual report (31 Jan), unified annual return, minimum wage revisions and ESI periods (1 Apr, 1 Oct) and statutory bonus (30 Nov). |

## Phase D: new modules (in progress)

| Module | What Saralix does now |
| --- | --- |
| POSH Internal Committee | Compliance, Committees. HR constitutes it and Saralix checks it against section 4: a senior woman presiding, two employee members, an external member, at least half women, a term of three years at most. Employees raise a complaint from self-service (Concerns). Only the committee's members and the person who filed can read it; HR sees counts. Descriptions, notes and outcomes are encrypted, emails carry no details, and the audit log records only that a case exists. Deadlines: inquiry in 90 days, report in 10 days, employer action in 60 days, with a flag for complaints filed more than three months after the incident. The annual report for the District Officer (received, disposed, pending, pending over 90 days, awareness sessions) comes from the cases. |
| Grievance Redressal Committee | Same module: equal employer and worker members, at most 10, a chairperson, women included. Grievances are decided in 30 days, with the appeal to the employer noted. |
| Still to build | Maternity eligibility and benefits; contract labour; women's night shift consent; health checks from 40; statutory registers and the unified annual return; DPDP privacy notice, consent log, breach workflow and retention rules. |

## Payroll product gaps (in progress)

| Gap | Status |
| --- | --- |
| Off-cycle runs and contractor TDS (194C, 194J) | ✅ Done |
| VPF, payroll NPS and the car perquisite | ✅ Done |
| PT for more states and LWF beyond Gujarat and Maharashtra | ✅ Done |
| Free tax and gratuity calculators | ✅ Done at /tools |
| Formula allowances | ✅ An allowance in a salary template can be a formula over gross, basic and HRA, like `min(basic * 0.1, 1600)`. Checked when the template is saved. |
| Custom employee fields | ✅ Settings, Custom employee fields: text, number, date, yes or no, or a list. On the employee form, profile and export, and on the employee's own profile when HR allows it. |
| Flexible benefit plan | ✅ Payroll, Flexible benefits. HR sets the heads and yearly caps (starting points: fuel, phone, meals, gifts, books, LTA; check them with a tax advisor). Employees pick amounts on their Tax page, within their special allowance; heads that don't save tax in the new regime aren't offered there. Approved plans hold a twelfth of each head back from special allowance every month. Employees claim it through an expense category linked to the head, up to what has built up. In the year's last pay, or the last pay before someone leaves, whatever is unclaimed is paid as taxable salary. TDS is projected as if the plan is claimed in full, and catches up on what wasn't. |
| Accounting journals | ✅ Each run has a balanced journal (salary and employer costs as expenses; PF, ESI, PT, LWF, TDS, NPS, loans and net pay as amounts owed) to download for Zoho Books, Tally Prime (XML voucher) or as plain CSV. Account names and a split by department are under Settings, Accounting. Held salaries stay out. |
| Public API and webhooks | ✅ Read-only API keys with scopes (employees, payroll, attendance, leave) at /api/v1, and signed webhooks for employee, payroll and leave events with retries. See docs/PUBLIC_API.md. |
| Zoho Books push | Next. Needs a Zoho API client (client ID and secret) set as Worker secrets; the journal import file works today. |
| WhatsApp payslips | Needs a WhatsApp Business provider account |
| Native mobile apps, live bank API | Need a decision on stores and the bank partner |
