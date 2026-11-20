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

- Professional tax for every state in the report, with yearly, half-yearly and quarterly states, and exemptions (disability, senior citizens). Odisha abolished PT from 1 Apr 2026.
- Labour welfare fund for every state: monthly (Haryana as a % with a cap, Punjab, Chandigarh, Kerala), half-yearly and yearly in December.
- Minimum wages by state, zone, industry and skill, revised every 1 April and 1 October, never below the central floor wage.

## Phase C: new features

Statutory bonus; OSH Code leave (1 day per 20 worked after 180 days, carry forward up to 30); overtime consent, twice the rate and the 144 hour quarterly cap; retrenchment compensation and the re-skilling fund; appointment letter mandatory fields and issue log; registration dates and documents; headcount thresholds per establishment; more compliance calendar dates.

## Phase D: new modules

POSH; Grievance Redressal Committee; maternity eligibility and benefits; contract labour; women's night shift consent; health checks from 40; statutory registers and the unified annual return; DPDP privacy notice, consent log, breach workflow and retention rules.
