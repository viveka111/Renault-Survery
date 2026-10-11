(function () {
'use strict';
const API = (window.CBP_API || '').replace(/\/$/, '');
const v = document.getElementById('view');
let key = ''; try { key = sessionStorage.getItem('cbp_admin') || ''; } catch (e) { key = ''; }
let data = null, insight = '', busy = false, msg = '', diag = null, diagBusy = false;

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) { const x = attrs[k]; if (x == null || x === false) continue;
    if (k === 'class') e.className = x; else if (k.startsWith('on')) e.addEventListener(k.slice(2), x); else e.setAttribute(k, x === true ? '' : x); }
  (function add(l) { for (const c of l) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else e.append(c.nodeType ? c : document.createTextNode(String(c))); } })(kids);
  return e;
}
async function api(path, opts) {
  let res;
  try { res = await fetch(API + path, { ...opts, headers: { 'x-admin-key': key, 'content-type': 'application/json' } }); }
  catch (x) { const e = new Error('network'); e.status = 0; throw e; }
  if (res.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!res.ok) { const e = new Error('http ' + res.status); e.status = res.status; throw e; }
  return res;
}

/* Plain-English reason for a recorded failure. */
function explain(f, origin) {
  const d = (f.detail || '').toLowerCase();
  if (f.code === 'network') return 'The browser could not reach the Worker. This is almost always the allowed-site setting: ALLOWED_ORIGIN in worker/wrangler.toml must be exactly ' + (origin || 'your site address') + ' (no path, no trailing slash). Fix it, then run: npx wrangler deploy. Also check that the Worker URL in config.js is right.';
  if (f.code === 'ai_unavailable') return 'The Worker has no API key. Run: npx wrangler secret put ANTHROPIC_API_KEY';
  if (f.code === 'rate_limited') return 'A safety limit was reached (' + (f.detail || 'rate limit') + '). Raise MAX_NEXT_PER_SESSION or MAX_NEXT_PER_IP_PER_HOUR in wrangler.toml if this is expected, for example when many people share one network.';
  if (f.code === 'bad_model_reply') return 'Claude replied, but not in the format the survey needs. The reply is shown below.';
  if (f.code === 'question_rejected') return 'Claude replied with a question the survey could not use (for example, too few options). What it sent is shown below.';
  if (f.code === 'user_skipped') return 'The respondent pressed "Taking long? Continue with the standard questions".';
  if (f.code === 'upstream_error' || f.kind === 'server') {
    const s = f.status;
    if (s === 401 || d.includes('authentication') || d.includes('x-api-key')) return 'Anthropic rejected the API key. Create a new key in the Console and set it again with: npx wrangler secret put ANTHROPIC_API_KEY';
    if (s === 403 || d.includes('permission')) return 'The API key does not have permission for this request. Check the key and its workspace in the Anthropic Console.';
    if (d.includes('credit') || d.includes('billing')) return 'Your Anthropic account has no credits. Add credits under Billing in the Console.';
    if (s === 404 || d.includes('model')) return 'Anthropic does not recognise the model name. Check CLAUDE_MODEL in wrangler.toml (default claude-haiku-5-5).';
    if (s === 429) return 'Anthropic is rate limiting this key. Wait a minute, or check your usage limits in the Console.';
    if (s === 529 || s >= 500) return 'Anthropic was temporarily overloaded or down. Usually passes on its own.';
    if (s === 400) return 'Anthropic rejected the request (see the message below). This often means a billing or credit problem.';
    return 'The Worker reached Anthropic, but the call failed. See the message below.';
  }
  return 'See the details below.';
}
function failureBox(x) {
  const fs = x.debug && x.debug.failures ? x.debug.failures : [];
  if (!fs.length) return null;
  return h('div', { class: 'dbg' },
    h('p', { class: 'kicker' }, 'Why the AI questions stopped'),
    fs.map(f => h('div', { class: 'dbgitem' },
      h('p', { class: 'a' }, 'Question ' + f.n + ' · ' + (f.code || f.kind) + (f.status ? ' · status ' + f.status : '')),
      h('p', null, explain(f, x.debug.origin)),
      f.detail ? h('pre', { class: 'detail' }, f.detail) : null)),
    x.debug.origin ? h('p', { class: 'c' }, 'Survey page: ' + x.debug.origin + ' · Worker: ' + x.debug.api) : null);
}

async function load() {
  msg = '';
  try { data = (await (await api('/api/admin/responses')).json()).responses; try { sessionStorage.setItem('cbp_admin', key); } catch (e) { /* ignore */ } }
  catch (e) {
    data = null;
    msg = e.status === 401 ? 'That key is not right.' : e.status === 503 ? 'Admin is disabled. Set ADMIN_KEY on the server.'
      : e.status === 0 ? 'This page could not reach the Worker. Check the Worker URL in config.js, and that ALLOWED_ORIGIN in wrangler.toml is exactly ' + location.origin + ' (then run npx wrangler deploy).'
      : 'Could not load responses.';
    if (e.status === 401) key = '';
  }
  render();
}
async function runDiagnose() {
  diagBusy = true; diag = null; render();
  try { diag = await (await api('/api/admin/diagnose')).json(); }
  catch (e) { diag = { error: e.status === 0 ? 'network' : 'failed' }; }
  diagBusy = false; render();
}
async function summarize() {
  busy = true; insight = ''; msg = ''; render();
  try { insight = (await (await api('/api/admin/summary', { method: 'POST', body: '{}' })).json()).text; }
  catch (e) { msg = 'Could not write the summary. Run "Test AI connection" to see why.'; }
  busy = false; render();
}
async function exportCsv() {
  try {
    const blob = await (await api('/api/admin/export.csv')).blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: 'car-brand-pulse.csv' });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { msg = 'Could not export.'; render(); }
}
function diagBox() {
  if (diagBusy) return h('p', { class: 'hint' }, 'Testing…');
  if (!diag) return null;
  if (diag.error) return h('div', { class: 'dbg' }, h('p', { class: 'a' }, 'Could not run the test'), h('p', null, diag.error === 'network' ? explain({ code: 'network' }, location.origin) : 'The Worker returned an error. Try again.'));
  const allowed = (diag.allowedOrigin || '').split(',').map(s => s.trim()).filter(Boolean);
  const originOk = allowed.includes(location.origin);
  const c = diag.claude || {};
  const rows = [
    ['API key on the Worker', diag.keySet ? 'Set' : 'NOT SET', diag.keySet],
    ['Model', diag.model, true],
    ['Claude answered a test call', c.ok ? 'Yes (' + c.ms + ' ms)' : 'No', !!c.ok],
    ['Allowed site matches this page', originOk ? 'Yes' : 'No: Worker allows "' + (diag.allowedOrigin || 'nothing') + '", this page is ' + location.origin, originOk],
    ['Limits', diag.limits.perSession + ' questions per respondent · ' + diag.limits.perIpPerHour + ' per network address per hour', true]
  ];
  return h('div', { class: 'dbg' },
    h('p', { class: 'kicker' }, 'AI connection test'),
    h('ul', { class: 'sum' }, rows.map(r => h('li', null, h('span', { class: 'c' }, r[0]), h('span', { class: 'a ' + (r[2] ? 'okc' : 'badc') }, (r[2] ? '✓ ' : '✗ ') + r[1])))),
    !c.ok ? h('p', null, explain({ kind: 'server', status: c.status, detail: c.detail, code: diag.keySet ? 'upstream_error' : 'ai_unavailable' }, location.origin)) : null,
    (!c.ok && c.detail) ? h('pre', { class: 'detail' }, c.detail) : null,
    !originOk ? h('p', null, explain({ code: 'network' }, location.origin)) : null);
}
function render() {
  v.textContent = '';
  if (!data) {
    const inp = h('input', { class: 'field', id: 'key', type: 'password', placeholder: 'Admin key', autocomplete: 'current-password' });
    inp.value = key;
    const go = () => { key = inp.value.trim(); load(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    v.append(h('section', { class: 'card' },
      h('p', { class: 'kicker' }, 'Survey owner'), h('h1', null, 'Responses'),
      inp, msg ? h('p', { class: 'notice' }, msg) : null,
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: go }, 'Open'))));
    return;
  }
  const done = data.filter(x => x.completed).length;
  const avg = data.length ? Math.round(data.reduce((s, x) => s + x.answers.length, 0) / data.length * 10) / 10 : 0;
  const failed = data.filter(x => x.debug && x.debug.failures && x.debug.failures.length).length;
  v.append(h('section', { class: 'card' },
    h('p', { class: 'kicker' }, 'Survey owner · responses'), h('h1', null, 'Responses'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, String(data.length)), 'started'),
      h('div', { class: 'stat' }, h('b', null, String(done)), 'finished'),
      h('div', { class: 'stat' }, h('b', null, String(failed)), 'AI fell back')),
    h('div', { class: 'actions' },
      h('button', { class: 'ghost', type: 'button', onclick: load }, 'Refresh'),
      h('button', { class: 'ghost', type: 'button', disabled: diagBusy, onclick: runDiagnose }, 'Test AI connection'),
      h('button', { class: 'ghost', type: 'button', disabled: !data.length, onclick: exportCsv }, 'Export CSV'),
      h('button', { class: 'primary', type: 'button', disabled: busy || !data.length, onclick: summarize }, busy ? 'Writing…' : 'Summarise with Claude')),
    diagBox(),
    msg ? h('p', { class: 'notice' }, msg) : null,
    insight ? h('div', { class: 'insight' }, insight) : null,
    !data.length ? h('p', { class: 'hint' }, 'No responses yet. Share the survey link, or take the survey yourself to see how it adapts.') : null,
    data.map(x => {
      const bad = x.debug && x.debug.failures && x.debug.failures.length;
      return h('details', { class: 'resp' + (bad ? ' warn' : '') },
        h('summary', null, h('span', null, new Date(x.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
          h('span', { class: 'c' }, (x.completed ? 'Finished' : 'Incomplete') + ' · ' + x.answers.length + ' answers · ' + x.mode + (bad ? ' · AI fell back' : ''))),
        failureBox(x),
        h('ul', { class: 'sum' }, x.answers.map(a => h('li', null,
          h('span', { class: 'c' }, (a.id === 'probe' ? 'Follow-up: ' : '') + a.question), h('span', { class: 'a' }, a.answer), a.note ? h('span', { class: 'c' }, 'Comment: ' + a.note) : null))));
    })
  ));
}
if (key) load(); else render();
})();
