const assert = require('assert');
const fs = require('fs');
const path = require('path');

const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'nainara_admin.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'nainara_login.html'), 'utf8');

assert(
  adminHtml.includes('const ADMIN_VIEWS =') &&
    adminHtml.includes('function getAdminViewFromHash()') &&
    adminHtml.includes("window.addEventListener('popstate'") &&
    adminHtml.includes('history.pushState(state') &&
    adminHtml.includes('history.replaceState(state'),
  'admin dashboard navigation must synchronize view changes with browser history and handle popstate navigation'
);

assert(
  adminHtml.includes('navigateTo: function(viewId, options = {})') &&
    adminHtml.includes('if (!isHistoryNavigation) this.updateBrowserHistory(viewId, shouldReplaceHistory);') &&
    adminHtml.includes('this.navigateTo(this.currentView || getAdminViewFromHash(), { replace: true });'),
  'admin navigateTo must push normal navigations, avoid pushing during browser back/forward, and preserve the current hash route after data load'
);

assert(
  adminHtml.includes("if (!token) { window.location.replace('nainara_login.html'); return; }") &&
    loginHtml.includes("window.location.replace('nainara_admin.html');") &&
    !loginHtml.includes("window.location.href = 'nainara_admin.html';"),
  'auth redirects should replace login/admin guard entries instead of adding stale login entries to the history stack'
);

assert(
  adminHtml.includes("logout: function()") &&
    adminHtml.includes("window.location.href = 'nainara_login.html';"),
  'explicit logout behavior must remain a normal navigation to the login page'
);

console.log('admin history regression checks passed');
