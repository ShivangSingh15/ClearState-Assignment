/**
 * Menu.gs — adds a "Dashboard" menu to the Google Sheet so the deployed
 * web app can be opened directly from the Sheet toolbar (OnOpen trigger).
 *
 * The DASHBOARD_URL constant must match your deployed /exec URL exactly.
 * Update it here whenever you create a new deployment.
 */

// ── Replace with your actual deployed /exec URL ──────────────────────────────
var DASHBOARD_URL = 'https://script.google.com/macros/s/AKfycbwvbw8tgKCLSce7h-9srv3kTbQKD6OWoQF0WLlhGTJqW5HNq43M9OlhaCWgzBePQvPO/exec';

/**
 * Runs automatically when the Google Sheet is opened.
 * Adds a "Dashboard" menu to the Sheet toolbar.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Dashboard')
    .addItem('Open performance dashboard', 'openDashboard')
    .addSeparator()
    .addItem('Refresh data cache', 'refreshFromMenu')
    .addToUi();
}

/** Opens the deployed dashboard in a new browser tab. */
function openDashboard() {
  var html = HtmlService
    .createHtmlOutput('<script>window.open("' + DASHBOARD_URL + '"); google.script.host.close();</script>')
    .setWidth(10).setHeight(10);
  SpreadsheetApp.getUi().showModalDialog(html, 'Opening dashboard…');
}

/** Clears the server cache from the Sheet menu (mirrors the Refresh button in the dashboard). */
function refreshFromMenu() {
  invalidateCache_();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  setConfigValue_('last_refresh', stamp);
  SpreadsheetApp.getUi().alert('✓ Data cache cleared. Refresh your dashboard tab to see the latest data.');
}
