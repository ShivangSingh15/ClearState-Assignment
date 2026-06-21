/**
 * Tests.gs  —  QA / CALCULATION-EVIDENCE LAYER
 * --------------------------------------------------------------------------
 * Run `runAllTests` from the Apps Script editor (Run ▸ runAllTests).
 * All assertions target published Roche figures and are filtered through
 * the multi-company path (getConfig_('Roche') + filterForCompany_) so the
 * test proves the full stack, not just the calc functions in isolation.
 */

function runAllTests() {
  const cfg  = getConfig_('Roche');                              // explicit company
  const rows = filterForCompany_(readFact_(), cfg.company);      // scoped to Roche
  const results = [];

  const check = function (name, got, expected, tol) {
    tol = tol === undefined ? 0.5 : tol;
    const pass = (got !== null && expected !== null && Math.abs(got - expected) <= tol);
    results.push((pass ? 'PASS  ' : 'FAIL  ') +
      name + '  got=' + fmt_(got) + ' expected=' + fmt_(expected));
  };

  // 1. Reported full-year totals (CHF m, published by Roche)
  const grpFY = computeKpi_(rows, cfg, {
    basis:'CHF', periodType:'FullYear', fiscalYear:2025, quarterIndex:4,
    entity:'Group', drilldown:'None'
  });
  check('Group FY2025 reported = 61516', grpFY.value, 61516);

  const phFY = computeKpi_(rows, cfg, {
    basis:'CHF', periodType:'FullYear', fiscalYear:2025, quarterIndex:4,
    entity:'Pharmaceuticals Division', drilldown:'None'
  });
  check('Pharma FY2025 reported = 47669', phFY.value, 47669);

  const diaFY = computeKpi_(rows, cfg, {
    basis:'CHF', periodType:'FullYear', fiscalYear:2025, quarterIndex:4,
    entity:'Diagnostics Division', drilldown:'None'
  });
  check('Diagnostics FY2025 reported = 13847', diaFY.value, 13847);

  // 2. CER uses PUBLISHED cer_value (≠ reported CHF — this is the key brief requirement)
  const grpQ1cer = computeKpi_(rows, cfg, {
    basis:'CER', periodType:'Quarter', fiscalYear:2025, quarterIndex:1,
    entity:'Group', drilldown:'None'
  });
  check('Group Q1-2025 CER = 14567.226 (published, != CHF 15440)', grpQ1cer.value, 14567.226, 0.01);

  // 3. YTD = sum of standalone quarters (NOT a pre-summed YTD block lookup)
  const q1 = pickQ_(rows, 'Group', 'None', 2025, 1);
  const q2 = pickQ_(rows, 'Group', 'None', 2025, 2);
  const q3 = pickQ_(rows, 'Group', 'None', 2025, 3);
  const ytdExpected = q1 + q2 + q3;
  const ytd = computeKpi_(rows, cfg, {
    basis:'CHF', periodType:'YTD', fiscalYear:2025, quarterIndex:3,
    entity:'Group', drilldown:'None'
  });
  check('Group YTD-Q3 2025 = Q1+Q2+Q3 (' + ytdExpected + ')', ytd.value, ytdExpected);

  // 4. QoQ from standalone quarters; Q1's previous is prior-year Q4
  const qoqKpi = computeKpi_(rows, cfg, {
    basis:'CHF', periodType:'Quarter', fiscalYear:2026, quarterIndex:1,
    entity:'Group', drilldown:'None'
  });
  const q4_2025 = pickQ_(rows, 'Group', 'None', 2025, 4);
  const q1_2026 = pickQ_(rows, 'Group', 'None', 2026, 1);
  check('Group Q1-2026 QoQ vs Q4-2025', qoqKpi.qoq, q1_2026 / q4_2025 - 1, 0.001);

  // 5. Incomplete full-year detection (2026 has only Q1)
  const fy26 = computeKpi_(rows, cfg, {
    basis:'CHF', periodType:'FullYear', fiscalYear:2026, quarterIndex:4,
    entity:'Group', drilldown:'None'
  });
  results.push((fy26.complete === false ? 'PASS  ' : 'FAIL  ') +
    'FY2026 flagged incomplete (presentQuarters=' + fy26.presentQuarters + ')');

  // 6. Published growth preferred over computed for full year
  check('Group FY2025 published CHF growth = 0.02', grpFY.growth, 0.02, 0.005);
  results.push('INFO  Group FY2025 growthSource = ' + grpFY.growthSource);

  // 7. Fiscal-year regrouping: start month = 4 (April demo)
  const fmApr = fiscalMap_(2025, 'Q2', 4);
  results.push((fmApr.fiscalYear === 2025 && fmApr.fiscalQ === 1 ? 'PASS  ' : 'FAIL  ') +
    'FY start=Apr: cal Q2-2025 → fiscal Q1-2025 (got FY' + fmApr.fiscalYear + ' Q' + fmApr.fiscalQ + ')');
  const fmAprQ1 = fiscalMap_(2025, 'Q1', 4);
  results.push((fmAprQ1.fiscalYear === 2024 && fmAprQ1.fiscalQ === 4 ? 'PASS  ' : 'FAIL  ') +
    'FY start=Apr: cal Q1-2025 → fiscal Q4-2024 (got FY' + fmAprQ1.fiscalYear + ' Q' + fmAprQ1.fiscalQ + ')');

  // 8. Multi-company isolation: getCompanyList_ returns Roche; filtering is clean
  const companies = getCompanyList_();
  results.push((companies.indexOf('Roche') >= 0 ? 'PASS  ' : 'FAIL  ') +
    'Company list contains Roche (got: ' + companies.join(', ') + ')');
  const rocheRows  = filterForCompany_(readFact_(), 'Roche');
  const unknownRows = filterForCompany_(readFact_(), '__nonexistent__');
  results.push((rocheRows.length > 0 && unknownRows.length === 0 ? 'PASS  ' : 'FAIL  ') +
    'filterForCompany_ isolates correctly (Roche=' + rocheRows.length +
    ' rows, unknown=0 rows, got ' + unknownRows.length + ')');

  Logger.log('\n===== PERFORMANCE DASHBOARD — CALCULATION QA =====\n' +
    results.join('\n') + '\n');
  return results;
}

// ---- helpers ---------------------------------------------------------------
function pickQ_(rows, entity, drill, fy, qIdx) {
  const cfg = getConfig_('Roche');
  const hit = rows.filter(function (r) {
    if (r.period_type !== 'Quarter' || r.entity !== entity) return false;
    if ((r.drilldown_dim || 'None') !== (drill || 'None')) return false;
    const fm = fiscalMap_(r.calendar_year, r.quarter, cfg.fiscal_year_start_month);
    return fm.fiscalYear === fy && fm.fiscalQ === qIdx;
  })[0];
  return hit ? hit.reported_value_chf : null;
}

function fmt_(v) {
  return v === null || v === undefined ? 'null' : (Math.round(v * 1000) / 1000);
}
