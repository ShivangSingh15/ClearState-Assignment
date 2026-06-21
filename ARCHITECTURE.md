# Architecture

This document explains the design behind the dashboard: the layer separation, the data
model, the contracts between layers, and the decisions that make the solution reusable for
companies other than Roche.

---

## 1. Design goals (from the brief)

1. **Scalable, reusable data model** — must work for *other companies*, not just Roche.
2. **Genuine application layer** — Apps Script does data access + business logic, not just
   static HTML hosting.
3. **Clear separation** between presentation, business logic, data access, and configuration.
4. **Correctness and traceability** over visual polish — published CER, correct YTD/QoQ
   basis, incomplete-year detection, config-driven fiscal year, and clear error surfacing.

---

## 2. Layered architecture

```
                          ┌─────────────────────────────────────────────┐
  Browser (client)        │  Index.html · Styles.html · JavaScript.html  │  PRESENTATION
                          │  holds *selection state only*, never data    │
                          └───────────────┬─────────────────────────────┘
                                          │ google.script.run  (getBootstrap / getDashboardData / refreshData)
                          ┌───────────────▼─────────────────────────────┐
  Apps Script (server)    │  Code.gs                                     │  CONTROLLER / WEB APP
                          │  doGet, safe_() envelope {ok,data}|{ok,error}│
                          └───────────────┬─────────────────────────────┘
                                          │ pure function calls
                          ┌───────────────▼─────────────────────────────┐
                          │  Calc.gs                                     │  BUSINESS LOGIC (pure)
                          │  fiscalMap_ · computeKpi_ · quarterSeries_   │
                          │  breakdown_ · QoQ · YTD · completeness       │
                          └───────────────┬─────────────────────────────┘
                                          │ typed row objects
                          ┌───────────────▼─────────────────────────────┐
                          │  DataAccess.gs   (only layer touching Sheet) │  DATA ACCESS
                          │  readFact_ · readDim_ · cache · type coerce  │
                          └───────────────┬─────────────────────────────┘
                                          │ getConfig_ / constants
                          ┌───────────────▼─────────────────────────────┐
                          │  Config.gs   SHEETS, FACT_COLS, cache, defs  │  CONFIGURATION
                          └───────────────┬─────────────────────────────┘
                                          │ batch getDataRange()
                          ┌───────────────▼─────────────────────────────┐
  Google Sheet (data)     │  00_CONFIG · 02_FACT · 03_DIM_Entity · RAW_* │  DATA + CONFIG LAYER
                          └─────────────────────────────────────────────┘
```

**One-way dependency rule:** presentation → controller → business logic → data access →
config → Sheet. Lower layers never call up. The business logic (`Calc.gs`) is pure: it takes
row objects + config + a selection and returns numbers, with no `SpreadsheetApp` calls, which
is exactly why it could be ported verbatim to Node (`simulate.js`) for validation.

### Layer contracts

| Layer | File(s) | Knows about | Never does |
|---|---|---|---|
| Presentation | `Index/Styles/JavaScript.html` | the *shape* of a response, selection state | hold the dataset; do math; know sheet structure |
| Controller | `Code.gs` | client calls, error enveloping, assembling a response | financial math; raw cell reads |
| Business logic | `Calc.gs` | fiscal mapping, KPI/QoQ/YTD/breakdown math | read the Sheet; know cell addresses |
| Data access | `DataAccess.gs` | sheet names, column order, batch reads, types, cache | financial meaning of the numbers |
| Configuration | `Config.gs` + `00_CONFIG` tab | constants, defaults, settings | anything domain-specific in code |

---

## 3. Data model

### Why long format
The `02_FACT` tab is a **long-format fact table**: one row per
`entity × period × period_type × metric`, with measures in fixed columns
(`reported_value_chf`, `cer_value`, growths). This is the single design decision that makes
the model reusable:

- **Add years / quarters** → append rows. No new columns, no code change.
- **Add a drill-down dimension** → rows carry a `drilldown_dim` tag; filtering is uniform.
- **Swap companies** → replace rows, set `company` in config. The schema is identical.

A wide format (a column per quarter) would force schema and code edits every reporting
period — the opposite of reusable.

### Grain and dimensions
- **Grain:** one measured value of an entity for one period under one period-type.
- **Entity hierarchy** lives in `03_DIM_Entity` (`entity_level`, `parent_entity`,
  `division`, `drilldown_dim`) so the fact table stays narrow and the hierarchy is editable
  in one place. Levels seen in the Roche data: Group → Division → (Region | Product |
  TherapeuticArea | BusinessArea → BusinessAreaRegion).
- **Drill-down dimensions** present out of the box: Region, Product, Therapeutic Area,
  Diagnostics Business Area, and a cross-sectional Business-Area × Region split.

### Period model
`period_type` ∈ {Quarter, HalfYear, YTD, FullYear}. The dashboard derives YTD and full-year
**from standalone `Quarter` rows** rather than trusting a pre-summed block, so:
- **YTD** = cumulative sum of standalone quarters from the fiscal-year start through the
  selected quarter.
- **QoQ** = `current_quarter / previous_quarter − 1`, with Q1's previous = prior-year Q4.
- **Full year** = the four quarters of a completed fiscal year; fewer than four ⇒ flagged
  incomplete.

### Currency basis — CER is real, not relabelled
Roche publishes **absolute CER sales**, so each fact row carries both `reported_value_chf`
and a genuine `cer_value` (plus `reported_growth_chf` and `cer_growth`). The toggle selects
between two published numbers. The code path `basisValue_(row, 'CER')` returns `cer_value`
and never substitutes the CHF figure — honouring the brief's prohibition on implying a CHF
value is a CER restatement.

### Provenance and data status
Every row carries `data_status`, `source_ref`, and `source_release`. Rows from the workbook
are `published`; the seeded 2024 quarters (reconstructed from Roche's published YoY growth as
`prior = current/(1+growth)`) are `reconstructed_from_published_yoy` with `cer_value` left
null. This gives three calendar years out of the box, exercises the data-status flag and the
partial/empty states, and is transparently replaceable with real FY2024 RoFIS data — no code
change.

---

## 4. Configuration-driven behaviour

Everything company- or calendar-specific is data, read from `00_CONFIG` at runtime:

| Key | Drives |
|---|---|
| `fiscal_year_start_month` | the fiscal-year grouping (`fiscalMap_`); 1 = Roche's Jan–Dec; evaluator can set 4 for an April demo |
| `default_basis` / `default_period_type` / `default_entity` / `default_year` | initial dashboard state |
| `currency_unit` / `company` | labels and headings (no "Roche"/"CHF" literals in code) |
| `source_name/url/file/release` / `retrieval_date` | the source + provenance indicator |
| `last_refresh` | stamped by `refreshData()`; shown in the header |
| `cer_methodology` / `incomplete_year_policy` | the CER tooltip and the incomplete badge text |

`getConfig_()` reads these with type coercion, validation, and safe defaults, so a missing or
malformed setting degrades gracefully instead of breaking the app.

### `fiscalMap_` — the reuse proof
`fiscalMap_(calendarYear, calQuarter, startMonth)` maps a calendar quarter to a (fiscalYear,
fiscalQuarter) pair. For `startMonth = 4` (April), calendar-Q2 becomes fiscal-Q1 of the same
year and calendar-Q1 becomes fiscal-Q4 of the prior year. Start months of 1/4/7/10 are exact;
others fall back to January with an `approximated` flag rather than silently mis-grouping.

---

## 5. Performance, validation, and error handling

- **Batch reads:** `DataAccess.gs` pulls each tab once via a single `getDataRange().getValues()`
  and builds typed row objects keyed by `FACT_COLS`. No per-cell reads, no per-request
  re-parsing of the whole sheet inside loops.
- **Caching:** `CacheService` holds the parsed fact/dim/config for 300s. `refreshData()`
  invalidates the cache and re-stamps `last_refresh`, so a Sheet edit appears on the next load.
- **Type handling:** `num_`/`str_` coerce sheet cells (which may arrive as strings, blanks,
  or numbers) into a stable typed shape; nulls are preserved (e.g. CER on reconstructed rows)
  rather than coerced to 0.
- **Schema-drift detection:** if `02_FACT`'s header order changes, the reader fails loudly
  with an `AppError` instead of silently mapping the wrong column.
- **Error surfacing:** every client-facing function runs inside `safe_()`, returning
  `{ok:true,data}` or `{ok:false,error}`. The front end renders an explicit error state — the
  brief's "errors surfaced clearly rather than failing silently".
- **Empty / incomplete states:** missing combinations return an empty payload that the UI
  renders as an empty state; incomplete full years are flagged, not silently summed.

---

## 6. Why Apps Script transformation over in-sheet formulas

The normalisation (raw RoFIS sheets → long-format `02_FACT`) is done **upstream in Python**
(`normalize.py`) and the analytics (YTD/QoQ/fiscal/basis) **server-side in `Calc.gs`** —
not as in-sheet array formulas. Reasons:

- the raw RoFIS layout (paired YTD + quarterly blocks, growth blocks, integer year headers,
  "thereof" sub-rows) needs real parsing logic, not spreadsheet formulas;
- pure server-side functions are unit-testable (`Tests.gs`) and portable (validated in Node);
- the Sheet stays a clean, human-readable data layer instead of a fragile formula web.

The Sheet remains the source of truth; the code remains the logic. That boundary is what
keeps the system maintainable and reusable.
