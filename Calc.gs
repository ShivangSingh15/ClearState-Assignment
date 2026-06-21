/**
 * Calc.gs  —  BUSINESS-LOGIC / CALCULATION LAYER
 * --------------------------------------------------------------------------
 * Pure functions over typed FACT rows. No Sheet access, no UI. This is where
 * every financial rule lives, so it can be unit-tested in isolation (see
 * Tests.gs). Key rules implemented exactly per the brief:
 *
 *   - Basis: CHF uses reported_value_chf; CER uses the PUBLISHED cer_value.
 *            A reported CHF value is never relabelled as CER.
 *   - Fiscal year: driven by config.fiscal_year_start_month (default Jan).
 *   - YTD: cumulative standalone quarters from fiscal-year start through the
 *          selected quarter (NOT a YoY of cumulative figures).
 *   - Full year: sum of the 4 standalone fiscal quarters; flagged INCOMPLETE
 *                when fewer than 4 are present.
 *   - QoQ: standalone_current / standalone_previous - 1; Q1's previous is the
 *          prior fiscal year's Q4. Never computed from YTD figures.
 *   - Growth %: published growth is preferred for exact published periods;
 *               otherwise computed YoY on same-basis aggregates and labelled
 *               "computed".
 */

const QUARTER_ORDER = ['Q1', 'Q2', 'Q3', 'Q4'];

/** Value for a row under the chosen basis. CER returns published cer_value only. */
function basisValue_(row, basis) {
  return basis === 'CER' ? row.cer_value : row.reported_value_chf;
}
function basisGrowth_(row, basis) {
  return basis === 'CER' ? row.cer_growth : row.reported_growth_chf;
}

/**
 * Map a calendar quarter to (fiscalYear, fiscalQuarterIndex 1..4) given a
 * fiscal-year start month. Quarter-aligned start months (1,4,7,10) are exact;
 * other start months fall back to January with a flag so we never mislabel.
 */
function fiscalMap_(calendarYear, calQuarter, startMonth) {
  const aligned = (startMonth === 1 || startMonth === 4 || startMonth === 7 || startMonth === 10);
  if (!aligned || startMonth === 1) {
    return { fiscalYear: calendarYear, fiscalQ: QUARTER_ORDER.indexOf(calQuarter) + 1,
             approximated: !aligned };
  }
  const startQ = { 4: 2, 7: 3, 10: 4 }[startMonth];   // calendar quarter that is fiscal Q1
  const calQn = QUARTER_ORDER.indexOf(calQuarter) + 1; // 1..4
  let fq = calQn - (startQ - 1);
  let fy = calendarYear;
  if (fq <= 0) { fq += 4; }                            // belongs to prior-started fiscal year
  // Fiscal year that STARTED in this calendar year covers calQ>=startQ.
  if (calQn < startQ) { fy = calendarYear - 1; }
  return { fiscalYear: fy, fiscalQ: fq, approximated: false };
}

/** Index standalone quarter rows by entity+drilldown for fast lookup. */
function indexQuarters_(rows, startMonth) {
  const idx = {};
  rows.forEach(function (r) {
    if (r.period_type !== 'Quarter') return;
    const fm = fiscalMap_(r.calendar_year, r.quarter, startMonth);
    const key = entKey_(r) + '|' + fm.fiscalYear + '|' + fm.fiscalQ;
    idx[key] = r;
  });
  return idx;
}
function entKey_(r) { return r.entity + '||' + r.drilldown_dim; }

/** Return the standalone quarter row for an entity in a fiscal (year, qIndex). */
function getQuarter_(qIndex_, entity, drilldown, fiscalYear, fIndex, qmap) {
  return qmap[entity + '||' + drilldown + '|' + fiscalYear + '|' + fIndex] || null;
}

/**
 * Compute one KPI bundle for the selected entity/period/basis.
 * periodType: 'Quarter' | 'YTD' | 'FullYear'
 * selQuarterIndex: fiscal quarter 1..4 (used by Quarter & YTD)
 */
function computeKpi_(rows, cfg, sel) {
  const startMonth = cfg.fiscal_year_start_month;
  const qmap = indexQuarters_(rows, startMonth);
  const basis = sel.basis;
  const ent = sel.entity, drill = sel.drilldown || 'None';
  const fy = sel.fiscalYear;

  const get = function (year, fIndex) {
    return qmap[ent + '||' + drill + '|' + year + '|' + fIndex] || null;
  };

  let value = null, prior = null, growth = null, growthSource = 'computed',
      qoq = null, complete = true, presentQuarters = 0, status = 'actual',
      label = '', basisAvailable = true;

  if (sel.periodType === 'Quarter') {
    const cur = get(fy, sel.quarterIndex);
    value = cur ? basisValue_(cur, basis) : null;
    status = cur ? cur.data_status : 'missing';
    label = cur ? cur.period_label : ('Q' + sel.quarterIndex + ' ' + fy);
    // published YoY growth for this quarter, if available
    if (cur && basisGrowth_(cur, basis) !== null) { growth = basisGrowth_(cur, basis); growthSource = 'published'; }
    // QoQ vs previous standalone quarter (Q1 -> prior FY Q4)
    const prevIdx = sel.quarterIndex === 1 ? 4 : sel.quarterIndex - 1;
    const prevYr  = sel.quarterIndex === 1 ? fy - 1 : fy;
    const prevRow = get(prevYr, prevIdx);
    const prevVal = prevRow ? basisValue_(prevRow, basis) : null;
    qoq = (value !== null && prevVal !== null && prevVal !== 0) ? (value / prevVal - 1) : null;
    basisAvailable = value !== null;

  } else if (sel.periodType === 'YTD') {
    let sum = 0, anyMissing = false, anyReconstructed = false;
    for (let f = 1; f <= sel.quarterIndex; f++) {
      const row = get(fy, f);
      const v = row ? basisValue_(row, basis) : null;
      if (v === null) { anyMissing = true; } else { sum += v; }
      if (row && row.data_status !== 'actual') anyReconstructed = true;
    }
    value = anyMissing ? null : sum;
    status = anyMissing ? 'partial' : (anyReconstructed ? 'reconstructed' : 'actual');
    label = 'YTD Q' + sel.quarterIndex + ' ' + fy;
    // prior-year YTD same basis for computed growth
    let psum = 0, pMissing = false;
    for (let f = 1; f <= sel.quarterIndex; f++) {
      const row = get(fy - 1, f);
      const v = row ? basisValue_(row, basis) : null;
      if (v === null) pMissing = true; else psum += v;
    }
    prior = pMissing ? null : psum;
    growth = (value !== null && prior !== null && prior !== 0) ? (value / prior - 1) : null;
    growthSource = 'computed';
    basisAvailable = value !== null;

  } else { // FullYear
    let sum = 0; presentQuarters = 0; let anyReconstructed = false;
    for (let f = 1; f <= 4; f++) {
      const row = get(fy, f);
      const v = row ? basisValue_(row, basis) : null;
      if (v !== null) { sum += v; presentQuarters++; if (row.data_status !== 'actual') anyReconstructed = true; }
    }
    complete = presentQuarters === 4;
    value = presentQuarters > 0 ? sum : null;
    status = !complete ? 'incomplete' : (anyReconstructed ? 'reconstructed' : 'actual');
    label = String(fy) + (complete ? '' : ' (incomplete)');
    // Prefer a PUBLISHED full-year row growth if one exists for this entity/basis.
    const pubFY = rows.filter(function (r) {
      return r.period_type === 'FullYear' && entKey_(r) === entKey_({entity: ent, drilldown_dim: drill}) &&
             r.calendar_year === fy && basisGrowth_(r, basis) !== null;
    })[0];
    if (complete && pubFY) { growth = basisGrowth_(pubFY, basis); growthSource = 'published'; }
    else {
      let psum = 0, pq = 0;
      for (let f = 1; f <= 4; f++) { const row = get(fy - 1, f); const v = row ? basisValue_(row, basis) : null; if (v !== null) { psum += v; pq++; } }
      prior = pq > 0 ? psum : null;
      growth = (value !== null && prior !== null && prior !== 0) ? (value / prior - 1) : null;
    }
    basisAvailable = value !== null;
  }

  return {
    entity: ent, drilldown: drill, basis: basis, fiscalYear: fy,
    periodType: sel.periodType, periodLabel: label,
    value: round_(value), growth: growth, growthSource: growthSource,
    qoq: qoq, complete: complete, presentQuarters: presentQuarters,
    status: status, basisAvailable: basisAvailable,
    unit: cfg.currency_unit
  };
}

/** Time series of standalone quarters (chronological) for the selected entity/basis. */
function quarterSeries_(rows, cfg, ent, drill, basis, yearsBack) {
  const startMonth = cfg.fiscal_year_start_month;
  const series = rows.filter(function (r) {
    return r.period_type === 'Quarter' && r.entity === ent && (r.drilldown_dim || 'None') === (drill || 'None');
  }).map(function (r) {
    const fm = fiscalMap_(r.calendar_year, r.quarter, startMonth);
    return {
      fiscalYear: fm.fiscalYear, fiscalQ: fm.fiscalQ,
      label: 'Q' + fm.fiscalQ + ' ' + fm.fiscalYear,
      value: round_(basisValue_(r, basis)),
      status: r.data_status,
      growth: basisGrowth_(r, basis)
    };
  }).filter(function (p) { return p.value !== null; })
    .sort(function (a, b) { return a.fiscalYear - b.fiscalYear || a.fiscalQ - b.fiscalQ; });
  return series;
}

/** Breakdown across a drilldown dimension for a given fiscal year & period. */
function breakdown_(rows, cfg, drilldownDim, basis, fiscalYear, periodType, quarterIndex) {
  const startMonth = cfg.fiscal_year_start_month;
  const entities = {};
  rows.forEach(function (r) {
    if ((r.drilldown_dim || 'None') !== drilldownDim) return;
    if (r.period_type !== 'Quarter') return;
    const fm = fiscalMap_(r.calendar_year, r.quarter, startMonth);
    if (fm.fiscalYear !== fiscalYear) return;
    const inScope = periodType === 'FullYear' ? true :
                    periodType === 'YTD' ? (fm.fiscalQ <= quarterIndex) :
                    (fm.fiscalQ === quarterIndex);
    if (!inScope) return;
    const v = basisValue_(r, basis);
    if (v === null) return;
    entities[r.entity] = (entities[r.entity] || 0) + v;
  });
  return Object.keys(entities)
    .map(function (k) { return { entity: k, value: round_(entities[k]) }; })
    .sort(function (a, b) { return b.value - a.value; });
}

function round_(v) { return v === null || v === undefined ? null : Math.round(v * 1000) / 1000; }
