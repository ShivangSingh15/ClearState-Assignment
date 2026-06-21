/**
 * DataAccess.gs  —  DATA-ACCESS LAYER
 * --------------------------------------------------------------------------
 * The ONLY layer that talks to the Spreadsheet for fact/dimension data.
 *
 * Multi-company design:
 *   - readFact_()  returns ALL rows (every company) in one batch read.
 *     Filtering to a specific company is done in Code.gs BEFORE passing rows
 *     to Calc.gs. This means one cache entry serves all companies (efficient),
 *     and Calc.gs never has to know about company filtering (clean separation).
 *   - readDim_()   returns ALL dimension rows (every company).
 *     Same pattern — filter in Code.gs.
 *   - readCompanies_() wraps getCompanyList_() from Config.gs.
 *
 * Adding a new company = append rows to 02_FACT + 03_DIM_Entity.
 * DataAccess.gs needs zero changes.
 */

/** Returns ALL fact rows (all companies) as typed objects (cached). */
function readFact_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY_FACT);
  if (hit) return JSON.parse(hit);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.FACT);
  if (!sh) throw new AppError('FACT_MISSING', 'Tab "' + SHEETS.FACT + '" not found.');

  const values = sh.getDataRange().getValues();   // single batch read
  if (values.length < 2) return [];

  const header = values[0].map(function (h) { return String(h).trim(); });
  const colIdx = {};
  FACT_COLS.forEach(function (name) { colIdx[name] = header.indexOf(name); });

  // Fail loudly if the sheet schema has drifted — better than silent wrong numbers.
  const missing = FACT_COLS.filter(function (c) { return colIdx[c] === -1; });
  if (missing.length) throw new AppError('FACT_SCHEMA', 'FACT is missing columns: ' + missing.join(', '));

  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const raw = values[r];
    if (String(raw[colIdx.entity] || '').trim() === '') continue;   // skip blank rows
    rows.push({
      company:       str_(raw[colIdx.company]),
      division:      str_(raw[colIdx.division]),
      entity:        str_(raw[colIdx.entity]),
      entity_level:  str_(raw[colIdx.entity_level]),
      parent_entity: str_(raw[colIdx.parent_entity]),
      drilldown_dim: str_(raw[colIdx.drilldown_dim]),
      metric:        str_(raw[colIdx.metric]),
      period_type:   str_(raw[colIdx.period_type]),
      calendar_year: num_(raw[colIdx.calendar_year]),
      quarter:       str_(raw[colIdx.quarter]),
      period_label:  str_(raw[colIdx.period_label]),
      period_start:  str_(raw[colIdx.period_start]),
      period_end:    str_(raw[colIdx.period_end]),
      currency_unit: str_(raw[colIdx.currency_unit]),
      reported_value_chf:  num_(raw[colIdx.reported_value_chf]),
      reported_growth_chf: num_(raw[colIdx.reported_growth_chf]),
      cer_value:           num_(raw[colIdx.cer_value]),
      cer_growth:          num_(raw[colIdx.cer_growth]),
      data_status:   str_(raw[colIdx.data_status]) || 'actual',
      source_ref:    str_(raw[colIdx.source_ref]),
      source_release:str_(raw[colIdx.source_release])
    });
  }

  // Cache can theoretically exceed 100 KB for very large datasets; catch silently.
  try { cache.put(CACHE_KEY_FACT, JSON.stringify(rows), CACHE_TTL_SECONDS); } catch (e) {}
  return rows;
}

/**
 * Returns ALL dimension rows (all companies) as typed objects (cached).
 * Schema: company | entity | entity_level | division | parent_entity | drilldown_dim
 */
function readDim_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY_DIM);
  if (hit) return JSON.parse(hit);

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.DIM);
  if (!sh) throw new AppError('DIM_MISSING', 'Tab "' + SHEETS.DIM + '" not found.');

  const values = sh.getDataRange().getValues();
  const header = values[0].map(function (h) { return String(h).trim(); });

  // Resolve column positions by header name (tolerates column reordering).
  const ci = function (name) { return header.indexOf(name); };
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(row[0] || '').trim() === '') continue;
    out.push({
      company:       str_(row[ci('company')]),
      entity:        str_(row[ci('entity')]),
      entity_level:  str_(row[ci('entity_level')]),
      division:      str_(row[ci('division')]),
      parent_entity: str_(row[ci('parent_entity')]),
      drilldown_dim: str_(row[ci('drilldown_dim')])
    });
  }

  try { cache.put(CACHE_KEY_DIM, JSON.stringify(out), CACHE_TTL_SECONDS); } catch (e) {}
  return out;
}

/** Clears server caches so the next read reflects freshly edited Sheet data. */
function invalidateCache_() {
  const c = CacheService.getScriptCache();
  c.removeAll([CACHE_KEY_FACT, CACHE_KEY_DIM, CACHE_KEY_COMPANIES]);
  invalidateAllConfigCache_();
}

// ---- type helpers -----------------------------------------------------------
function str_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
