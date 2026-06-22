# Calculation / QA Evidence

This document provides test-case evidence for the dashboard's calculations, as
required by Deliverable 5. Every figure below is asserted automatically by
`runAllTests()` in `Tests.gs` (run it from the Apps Script editor → **View → Logs**)
and was independently re-verified in Node via `data/simulate.js`.

All sales figures are in CHF million unless the basis is stated as CER.

---

## A. Reported CHF vs CER (basis logic)

CER is a **separately published** Roche measure, not a relabelled CHF value. The
toggle switches between two different published numbers.

| Entity / period | Reported CHF | CER (published) | Same number? |
|---|---|---|---|
| Group, Q1 2025 | 15,440 | 14,567.226 | No — distinct values |

`basisValue_(row, 'CER')` returns `cer_value`; it never falls back to the CHF figure.
For rows where Roche did not publish a CER value (the reconstructed 2024 quarters),
CER is `null` and the UI shows "No CER value" rather than inventing one.

**Pass criterion:** Group Q1 2025 CER = 14,567.226 and ≠ 15,440. ✓

---

## B. Fiscal-year grouping driven by configuration

`fiscalMap_(calendarYear, calQuarter, startMonth)` reads `fiscal_year_start_month`
from the Sheet (`00_CONFIG`, default 1 = January).

| Config start month | Calendar quarter | Maps to fiscal | 
|---|---|---|
| 1 (Roche official) | Q2 2025 | FY2025 Q2 |
| 4 (April demo) | Q2 2025 | FY2025 Q1 |
| 4 (April demo) | Q1 2025 | FY2024 Q4 |

**Pass criterion:** with start month 4, calendar Q2-2025 → fiscal Q1-2025 and
calendar Q1-2025 → fiscal Q4-2024. ✓ A non-January setting is labelled in the UI as
an analytical demonstration, not Roche's official calendar.

---

## C. YTD = cumulative standalone quarters

YTD sums standalone quarter values from the fiscal-year start through the selected
quarter. It is **not** read from a pre-summed YTD block and **not** a YoY of cumulative
figures.

| Entity | Period | Component quarters | YTD total |
|---|---|---|---|
| Group | YTD through Q3 2025 | Q1 15,440 + Q2 15,504 + Q3 14,918 | 45,862 |

**Pass criterion:** Group YTD-Q3 2025 = 45,862 (equals the sum of the three standalone
quarters). ✓

---

## C2. Incomplete full-year detection

A FullYear view counts standalone quarters present for the fiscal year; fewer than 4
is flagged INCOMPLETE and the partial total is never presented as a final full year.

| Entity | Year | Quarters present | Flag |
|---|---|---|---|
| Group | 2025 | 4 | Complete |
| Group | 2026 | 1 (Q1 only) | **INCOMPLETE** |

**Pass criterion:** FY2026 reports `presentQuarters = 1`, `complete = false`. ✓

---

## D. QoQ from standalone quarters

`QoQ% = current_quarter / previous_quarter − 1`, using standalone quarters only.
For Q1 the previous quarter is Q4 of the preceding fiscal year.

| Entity | Current | Previous | QoQ |
|---|---|---|---|
| Group | Q1 2026 = 14,722 | Q4 2025 = 15,654 | −5.95% |
| Core Lab | Q4 2025 = 1,926 | Q3 2025 = 1,849 | +4.2% |
| Core Lab | Q1 2026 = 1,798 | Q4 2025 = 1,926 | −6.6% |

In the detail table, QoQ shows the latest quarter within the selected period
(FullYear → Q4-vs-Q3; YTD-Qn → Qn-vs-Qn−1; Quarter → the selected quarter). It is
never derived from YTD figures.

**Pass criterion:** Group Q1-2026 QoQ vs Q4-2025 = −5.95%. ✓

---

## E. Published vs computed growth provenance

When Roche publishes a growth figure for the exact period, the dashboard shows it and
tags it **published**. Otherwise it computes YoY on same-basis aggregates and tags it
**computed**. This traceability is shown as a badge on every growth value.

| Entity | Period | Growth | Source |
|---|---|---|---|
| Group | FY2025 (CHF) | +0.02 | published |
| Group | YTD-Q3 2025 | computed YoY | computed |

**Pass criterion:** Group FY2025 growth = +0.02 with source = published. ✓

---

## F. Full-stack / multi-company isolation

The calculations run on rows already filtered to the selected company, so the same
logic serves any company without modification.

| Check | Result |
|---|---|
| `getCompanyList_()` | returns Roche |
| `filterForCompany_('Roche')` | 885 rows |
| `filterForCompany_('__nonexistent__')` | 0 rows |

**Pass criterion:** filtering isolates correctly; unknown company yields 0 rows. ✓

---

## How to reproduce

1. **In Apps Script:** open `Tests.gs`, run `runAllTests`, read **View → Logs** —
   every line should start with `PASS`.
2. **Locally:** `node data/simulate.js` runs the same assertions against
   `FACT_long.csv`.
