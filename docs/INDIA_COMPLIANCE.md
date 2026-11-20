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

## Phase D: new modules

POSH; Grievance Redressal Committee; maternity eligibility and benefits; contract labour; women's night shift consent; health checks from 40; statutory registers and the unified annual return; DPDP privacy notice, consent log, breach workflow and retention rules.
