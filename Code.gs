/**
 * Code.gs  —  CONTROLLER / WEB-APP ENTRY LAYER
 * --------------------------------------------------------------------------
 * The ONLY layer exposed to the browser. Orchestrates Config → DataAccess
 * → Calc and returns JSON-serialisable bundles. Owns error handling.
 *
 * Multi-company design:
 *   - Every client call carries sel.company (string).
 *   - getConfig_(sel.company) returns config for that company.
 *   - filterForCompany_() slices the full FACT and DIM arrays to that company
 *     BEFORE anything is passed to Calc.gs. Calc.gs is therefore unaware of
 *     multi-tenancy and needs zero changes.
 *   - getBootstrap() returns the company list so the client can render a
 *     company selector dropdown.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Performance Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Every server call returns {ok, data} or {ok, error} — never a raw exception. */
function safe_(fn) {
  try { return { ok: true, data: fn() }; }
  catch (e) {
    const code = (e && e.code) ? e.code : 'SERVER_ERROR';
    return { ok: false, error: { code: code, message: String(e && e.message || e) } };
  }
}

/**
 * Bootstrap payload: company list, filter options, config, source metadata.
 * Called ONCE on page load. Accepts an optional company name to bootstrap
 * for a specific company (used when the company selector changes).
 *
 * @param {string} [company]  Company to load config for; defaults to global default.
 */
function getBootstrap(company) {
  return safe_(function () {
    const companies = getCompanyList_();    // from Config.gs — reads 01_COMPANY
    const cfg  = getConfig_(company);       // merged global + company-specific
    const allRows = readFact_();
    const allDim  = readDim_();

    // Slice to the requested company.
    const rows = filterForCompany_(allRows, cfg.company);
    const dim  = filterDimForCompany_(allDim, cfg.company);

    const years = uniqueSorted_(rows
      .filter(function (r) { return r.period_type === 'Quarter'; })
      .map(function (r) {
        return fiscalMap_(r.calendar_year, r.quarter, cfg.fiscal_year_start_month).fiscalYear;
      }));

    const drilldowns = uniqueSorted_(dim
      .map(function (d) { return d.drilldown_dim; })
      .filter(function (d) { return d && d !== 'None'; }));

    // Top-level selectable entities (Group + Division level) for primary filter.
    const topEntities = dim
      .filter(function (d) {
        return d.entity_level === 'Group' || d.entity_level === 'Division';
      })
      .map(function (d) { return d.entity; });

    return {
      companies: companies,                  // drives company selector dropdown
      config: {
        company:                 cfg.company,
        currency_unit:           cfg.currency_unit,
        fiscal_year_start_month: cfg.fiscal_year_start_month,
        default_basis:           cfg.default_basis,
        default_period_type:     cfg.default_period_type,
        default_entity:          cfg.default_entity || topEntities[0],
        default_year:            cfg.default_year || years[years.length - 1],
        cer_methodology:         cfg.cer_methodology,
        fiscalDemo:              cfg.fiscal_year_start_month !== 1
      },
      source: {
        name:         cfg.source_name,
        url:          cfg.source_url,
        file:         cfg.source_file,
        release:      cfg.source_release,
        retrieved:    cfg.retrieval_date,
        last_refresh: cfg.last_refresh
      },
      years:     years,
      drilldowns: drilldowns,
      entities:  uniqueSorted_(topEntities)
    };
  });
}

/**
 * Main data endpoint. All filters including company are in sel.
 *
 * @param {Object} sel {
 *   company, basis, periodType, fiscalYear, quarterIndex,
 *   entity, drilldown, breakdownDim
 * }
 */
function getDashboardData(sel) {
  return safe_(function () {
    const cfg     = getConfig_(sel.company);
    const allRows = readFact_();
    const allDim  = readDim_();

    // Filter to the requested company BEFORE any calculation.
    const rows = filterForCompany_(allRows, cfg.company);
    const dim  = filterDimForCompany_(allDim, cfg.company);   // used for future dim-based features

    sel = normaliseSelection_(sel, cfg, rows);

    const kpi    = computeKpi_(rows, cfg, sel);
    const series = quarterSeries_(rows, cfg, sel.entity, sel.drilldown, sel.basis);
    const bd     = breakdown_(rows, cfg, sel.breakdownDim, sel.basis, sel.fiscalYear,
                              sel.periodType, sel.quarterIndex);

    const total = bd.reduce(function (a, b) { return a + (b.value || 0); }, 0);
    const table = bd.map(function (m) {
      const memberSel = {
        basis: sel.basis, periodType: sel.periodType, fiscalYear: sel.fiscalYear,
        quarterIndex: sel.quarterIndex, entity: m.entity, drilldown: sel.breakdownDim
      };
      const mk = computeKpi_(rows, cfg, memberSel);
      return {
        entity: m.entity, value: m.value,
        share:  total ? m.value / total : null,
        growth: mk.growth, growthSource: mk.growthSource,
        qoq:    mk.qoq,   status: mk.status
      };
    });

    const yearCompleteness = fullYearCompleteness_(rows, cfg, sel.entity, sel.drilldown, sel.fiscalYear);

    return {
      selection: sel, kpi: kpi, series: series, breakdown: bd, table: table,
      breakdownDim: sel.breakdownDim,
      totals: { value: round_(total), unit: cfg.currency_unit },
      completeness: yearCompleteness,
      generatedAt: new Date().toISOString()
    };
  });
}

/** Members available for the primary entity filter at a given drilldown level. */
function getEntitiesForDrilldown(drilldownDim, company) {
  return safe_(function () {
    const cfg = getConfig_(company);
    const dim = filterDimForCompany_(readDim_(), cfg.company);
    return uniqueSorted_(dim
      .filter(function (d) { return d.drilldown_dim === drilldownDim; })
      .map(function (d) { return d.entity; }));
  });
}

/**
 * Refresh: clears all caches and stamps last_refresh in 00_CONFIG.
 * A data change in the normalised Sheet becomes visible after refresh
 * with zero code changes — this is the acceptance-check proof.
 */
function refreshData() {
  return safe_(function () {
    invalidateCache_();
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    setConfigValue_('last_refresh', stamp);
    return { last_refresh: stamp };
  });
}

// ---- private helpers -------------------------------------------------------

/** Filter fact rows to a single company (case-sensitive match on the company column). */
function filterForCompany_(rows, company) {
  if (!company) return rows;
  return rows.filter(function (r) { return r.company === company; });
}

/** Filter dimension rows to a single company. */
function filterDimForCompany_(dim, company) {
  if (!company) return dim;
  return dim.filter(function (d) { return d.company === company; });
}

function normaliseSelection_(sel, cfg, rows) {
  sel = sel || {};
  const years = uniqueSorted_(rows
    .filter(function (r) { return r.period_type === 'Quarter'; })
    .map(function (r) {
      return fiscalMap_(r.calendar_year, r.quarter, cfg.fiscal_year_start_month).fiscalYear;
    }));
  return {
    company:      sel.company      || cfg.company,
    basis:        sel.basis === 'CER' ? 'CER' : 'CHF',
    periodType:   ['Quarter','YTD','FullYear'].indexOf(sel.periodType) >= 0
                    ? sel.periodType : cfg.default_period_type,
    fiscalYear:   Number(sel.fiscalYear) || years[years.length - 1],
    quarterIndex: clampQ_(sel.quarterIndex),
    entity:       sel.entity       || cfg.default_entity || 'Group',
    drilldown:    sel.drilldown    || 'None',
    breakdownDim: sel.breakdownDim || 'Region'
  };
}

function clampQ_(q) { q = Number(q); return (q >= 1 && q <= 4) ? Math.floor(q) : 4; }

function fullYearCompleteness_(rows, cfg, entity, drill, fy) {
  let present = 0;
  for (let f = 1; f <= 4; f++) {
    const hit = rows.some(function (r) {
      if (r.period_type !== 'Quarter' || r.entity !== entity) return false;
      if ((r.drilldown_dim || 'None') !== (drill || 'None')) return false;
      const fm = fiscalMap_(r.calendar_year, r.quarter, cfg.fiscal_year_start_month);
      return fm.fiscalYear === fy && fm.fiscalQ === f && r.reported_value_chf !== null;
    });
    if (hit) present++;
  }
  return { presentQuarters: present, complete: present === 4 };
}

function uniqueSorted_(arr) {
  const s = {};
  arr.forEach(function (x) { if (x !== '' && x !== null && x !== undefined) s[x] = true; });
  return Object.keys(s).sort(function (a, b) {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }).map(function (k) { const n = Number(k); return isNaN(n) ? k : n; });
}
