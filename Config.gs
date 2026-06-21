/**
 * Config.gs  —  CONFIGURATION LAYER
 * --------------------------------------------------------------------------
 * Single source of truth for sheet/column names and runtime settings read
 * from the Google Sheet.
 *
 * Multi-company design:
 *   - 00_CONFIG  holds GLOBAL settings (defaults, policies, last_refresh).
 *   - 01_COMPANY holds one row per company with company-specific settings
 *                (fiscal year, currency, source metadata, etc.).
 *   - getConfig_(company) merges global → company-specific so any key in
 *     01_COMPANY silently overrides a global default.
 *
 * Adding a new company = append one row to 01_COMPANY + rows to 02_FACT
 * and 03_DIM_Entity. Zero code changes.
 */

const SHEETS = Object.freeze({
  CONFIG:  '00_CONFIG',
  COMPANY: '01_COMPANY',   // one row per company
  FACT:    '02_FACT',
  DIM:     '03_DIM_Entity'
});

// Column order of 02_FACT (keys must match header row exactly).
const FACT_COLS = Object.freeze([
  'company','division','entity','entity_level','parent_entity','drilldown_dim',
  'metric','period_type','calendar_year','quarter','period_label','period_start',
  'period_end','currency_unit','reported_value_chf','reported_growth_chf',
  'cer_value','cer_growth','data_status','source_ref','source_release'
]);

// Column order of 01_COMPANY (keys must match header row exactly).
const COMPANY_COLS = Object.freeze([
  'company','fiscal_year_start_month','fiscal_year_label_mode','currency_unit',
  'default_entity','default_year','default_basis',
  'cer_methodology','source_name','source_url','source_file','source_release'
]);

const CACHE_TTL_SECONDS = 300;
const CACHE_KEY_FACT    = 'FACT_v2';
const CACHE_KEY_CONFIG  = 'CONFIG_v2_';   // suffixed with company name
const CACHE_KEY_DIM     = 'DIM_v2';
const CACHE_KEY_COMPANIES = 'COMPANIES_v2';

/**
 * Returns a merged config object for the given company.
 * Falls back to cfg.default_company (from 00_CONFIG) when company is omitted.
 *
 * Merge order (later wins):
 *   1. Hard-coded code defaults  (safety net)
 *   2. 00_CONFIG global settings
 *   3. 01_COMPANY row for the requested company
 */
function getConfig_(company) {
  const cache = CacheService.getScriptCache();

  // Resolve the target company before cache lookup so the cache key is stable.
  // We need at least the global config to know default_company.
  const globalCfg = readGlobalConfig_();
  const targetCompany = company || globalCfg.default_company || 'Roche';
  const cacheKey = CACHE_KEY_CONFIG + targetCompany;

  const hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);

  // Start from global settings, then overlay company row.
  const cfg = Object.assign({}, globalCfg);
  cfg.company = targetCompany;

  const companyRow = readCompanyRow_(targetCompany);
  if (companyRow) {
    Object.keys(companyRow).forEach(function (k) {
      if (companyRow[k] !== '' && companyRow[k] !== null) cfg[k] = companyRow[k];
    });
  }

  // Validate / default every value the app depends on.
  cfg.fiscal_year_start_month = clampMonth_(cfg.fiscal_year_start_month, 1);
  cfg.default_basis      = (cfg.default_basis === 'CER') ? 'CER' : 'CHF';
  cfg.default_period_type = ['Quarter','YTD','FullYear'].indexOf(cfg.default_period_type) >= 0
                             ? cfg.default_period_type : 'FullYear';
  cfg.currency_unit      = cfg.currency_unit || 'CHF m';
  cfg.default_entity     = cfg.default_entity || 'Group';

  cache.put(cacheKey, JSON.stringify(cfg), CACHE_TTL_SECONDS);
  return cfg;
}

/** Returns the list of available company names from 01_COMPANY (cached). */
function getCompanyList_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY_COMPANIES);
  if (hit) return JSON.parse(hit);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.COMPANY);
  if (!sh) throw new AppError('COMPANY_MISSING', 'Tab "' + SHEETS.COMPANY + '" not found.');

  const values = sh.getDataRange().getValues();
  const companies = [];
  for (let r = 1; r < values.length; r++) {
    const name = String(values[r][0] || '').trim();
    if (name) companies.push(name);
  }
  cache.put(CACHE_KEY_COMPANIES, JSON.stringify(companies), CACHE_TTL_SECONDS);
  return companies;
}

/** Writes a single config key in 00_CONFIG (used by refreshData). */
function setConfigValue_(key, value) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  const values = sh.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === key) {
      sh.getRange(r + 1, 2).setValue(value);
      invalidateAllConfigCache_();
      return;
    }
  }
  sh.appendRow([key, value, 'added at runtime']);
  invalidateAllConfigCache_();
}

// ---- private helpers -------------------------------------------------------

function readGlobalConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.CONFIG);
  if (!sh) throw new AppError('CONFIG_MISSING', 'Tab "' + SHEETS.CONFIG + '" not found.');
  const values = sh.getDataRange().getValues();
  const cfg = {};
  for (let r = 1; r < values.length; r++) {
    const key = String(values[r][0] || '').trim();
    if (key) cfg[key] = coerce_(values[r][1]);
  }
  return cfg;
}

function readCompanyRow_(company) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEETS.COMPANY);
  if (!sh) return null;                          // 01_COMPANY optional — single company still works
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return null;
  const hdrs = values[0].map(function (h) { return String(h).trim(); });
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === company) {
      const row = {};
      hdrs.forEach(function (h, i) { if (h) row[h] = coerce_(values[r][i]); });
      return row;
    }
  }
  return null;                                   // company not found — caller falls back to global
}

function invalidateAllConfigCache_() {
  // Remove all per-company config cache keys we know about.
  const companies = [];
  try { companies.push.apply(companies, getCompanyList_()); } catch (e) {}
  const keys = companies.map(function (c) { return CACHE_KEY_CONFIG + c; });
  keys.push(CACHE_KEY_COMPANIES);
  if (keys.length) CacheService.getScriptCache().removeAll(keys);
}

function coerce_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  return s;
}
function clampMonth_(m, dflt) {
  const n = Number(m);
  return (n >= 1 && n <= 12) ? Math.floor(n) : dflt;
}

function AppError(code, message) {
  this.name = 'AppError'; this.code = code; this.message = message;
}
AppError.prototype = Object.create(Error.prototype);
