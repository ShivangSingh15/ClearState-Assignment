# Performance Dashboard
### Google Sheets · Google Apps Script · HTML/CSS/JS

A browser-based financial dashboard reviewing segment performance.
Google Sheets is the data + configuration layer, Google Apps Script is the application layer,
and the front end is HTML/CSS/JS served by Apps Script.

**Multi-company ready.** Nothing in the code hard-codes "Roche", "CHF", or "January".
Adding a new company requires only new rows in the Sheet — zero code changes.
Currently seeded with Roche data only.

---

**Live dashboard:** [Roche Dashboard](https://script.google.com/macros/s/AKfycbwvbw8tgKCLSce7h-9srv3kTbQKD6OWoQF0WLlhGTJqW5HNq43M9OlhaCWgzBePQvPO/exec)

**Data layer (Google Sheet):** [Google Sheet Backend](https://docs.google.com/spreadsheets/d/1Im4rIFsitn0cMLANcXHPbtnbQdJDLp5RZv0Mt5kTfLs/edit?usp=sharing)

The Google Sheet is the single source of truth — all KPI values, chart data, and calculations are driven from the `02_FACT` tab at runtime. The deployed dashboard reads nothing from hard-coded arrays; changing a value in the Sheet and clicking **Refresh** in the dashboard reflects it immediately.

---

## 1. Files in this package

```
roche-dashboard/
├── data/
│   ├── Roche_Dashboard_DataLayer.xlsx   ← IMPORT THIS into Google Sheets
│   ├── normalize.py                     ← parses raw RoFIS workbook → FACT rows (creates FACT_long.csv)
│   ├── build_datalayer.py               ← assembles the multi-tab .xlsx (creates Roche_Dashboard_DataLayer.xlsx, which we than import on the google sheet)
│   ├── FACT_long.csv                    ← 885-row normalised fact table (audit copy)
│   └── simulate.js                      ← Node port of Calc.gs for validation (not needed on Google App Script)
├── apps-script/
│   ├── Config.gs        ← CONFIGURATION layer
│   ├── DataAccess.gs    ← DATA-ACCESS layer
│   ├── Calc.gs          ← BUSINESS-LOGIC layer  (pure functions — no company awareness)
│   ├── Code.gs          ← CONTROLLER / web-app layer
│   ├── Tests.gs         ← QA layer
│   ├── Index.html       ← HTML structure
│   ├── Styles.html      ← CSS
│   └── JavaScript.html  ← client controller
├── README.md
└── ARCHITECTURE.md
└── QA_EVIDENCE.md
```

---

## 2. Google Sheet structure (12 tabs)

| Tab | Layer | Purpose |
|---|---|---|
| `00_CONFIG` | Configuration | Global settings: `default_company`, `last_refresh`, `incomplete_year_policy` |
| `01_COMPANY` | Configuration | **One row per company** — fiscal year, currency, source metadata, CER note |
| `02_FACT` | Normalised analytical | 885 rows, long-format, one row per entity × period × period-type |
| `03_DIM_Entity` | Normalised (dimension) | Entity hierarchy with `company` prefix column |
| `RAW_*` (8 tabs) | Raw source | Verbatim Roche RoFIS sheets for traceability |

### Why two config tabs?
`00_CONFIG` holds settings that apply globally (e.g. `incomplete_year_policy`,
`last_refresh`). `01_COMPANY` holds settings that vary per company — each company gets
its own fiscal year, currency, source URL, and CER methodology note.
`getConfig_(company)` merges both: global first, company-specific overwrites.

### Adding a new company (no code changes)
1. Add one row to `01_COMPANY` (company name, FY start month, currency, source details).
2. Append normalised rows to `02_FACT` (same 21-column schema, `company` column set to the new name).
3. Append entity hierarchy rows to `03_DIM_Entity` (same 6-column schema, `company` column set).
4. Click **Refresh**. The company selector appears in the dashboard automatically.

---

## 3. Deployment (~10 minutes)

### Step 1 — Import the Sheet
1. [sheets.google.com](https://sheets.google.com) → **Blank**.
2. **File → Import → Upload** → `Roche_Dashboard_DataLayer.xlsx` → **Replace spreadsheet**.
3. Confirm all 12 tabs imported.

### Step 2 — Create the Apps Script project
1. In the Sheet: **Extensions → Apps Script**.
2. Delete the stub `Code.gs`.
3. Create each file from `apps-script/` — matching names exactly:
   - Script files (**+ → Script**): `Config`, `DataAccess`, `Calc`, `Code`, `Tests`
   - HTML files (**+ → HTML**): `Index`, `Styles`, `JavaScript`
4. **Save** (Ctrl/Cmd-S).

### Step 3 — Run tests first
1. Select `runAllTests` in the function dropdown → **Run**.
2. Approve the authorization prompt.
3. **View → Logs** — all lines should start with `PASS`.

### Step 4 — Deploy
1. **Deploy → New deployment → Web app**.
2. Execute as: **Me** · Who has access: **Anyone**.
3. Copy the `/exec` URL — this is your submission URL.

---

## 4. AI usage note

Built with **Claude (Anthropic)** as coding assistant: Data normalisation scripts, Apps Script back end, HTML/CSS/JS front end, and Node-based
validation. I remain responsible for architecture, financial calculation correctness,
security, code review, and testing. No credentials or private data were used in any prompt.

---

## 5. QA evidence

`runAllTests()` asserts against published Roche figures (10 checks):

| Check | Expected |
|---|---|
| Group FY2025 reported | 61,516 CHF m |
| Pharma FY2025 reported | 47,669 CHF m |
| Diagnostics FY2025 reported | 13,847 CHF m |
| Group Q1-2025 **CER** | 14,567.226 (published, ≠ CHF 15,440) |
| Group YTD-Q3 2025 | Q1+Q2+Q3 (standalone sum, not pre-summed block) |
| Group Q1-2026 QoQ | current/previous − 1 from standalone quarters |
| FY2026 completeness | flagged **INCOMPLETE** (1 quarter present) |
| FY2025 growth source | `published` (Roche's own figure preferred) |
| April-FY remap | cal-Q2-2025 → fiscal-Q1-2025 |
| Multi-company isolation | `filterForCompany_('Roche')` returns rows; unknown company returns 0 |
